import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(projectRoot, "src");
const entryFile = path.join(srcRoot, "main.jsx");
const outputDir = path.join(projectRoot, "experiments", "codeCleanup", "output");

const parserPlugins = [
  "jsx",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "importMeta",
  "optionalChaining",
  "nullishCoalescingOperator",
];

function toProjectPath(filePath) {
  return path.relative(projectRoot, filePath).replaceAll("\\", "/");
}

function readCode(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function parseFile(filePath) {
  return parse(readCode(filePath), {
    sourceType: "module",
    plugins: parserPlugins,
  });
}

function getLocation(node) {
  const line = node.loc?.start.line ?? 1;
  const column = (node.loc?.start.column ?? 0) + 1;
  return { line, column };
}

function isRelativeImport(source) {
  return source.startsWith("./") || source.startsWith("../");
}

function resolveImport(fromFile, source) {
  if (!isRelativeImport(source)) return null;
  const basePath = path.resolve(path.dirname(fromFile), source);
  const candidates = [
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
  ];
  if ([".js", ".jsx", ".mjs"].includes(path.extname(basePath))) {
    candidates.unshift(basePath);
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }
  return null;
}

function collectReachableFiles(startFile) {
  const reachableFiles = new Set();
  const queue = [path.normalize(startFile)];

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (reachableFiles.has(filePath)) continue;
    reachableFiles.add(filePath);

    const ast = parseFile(filePath);
    traverse(ast, {
      ImportDeclaration(importPath) {
        const resolved = resolveImport(filePath, importPath.node.source.value);
        if (!resolved) return;
        if (!reachableFiles.has(resolved)) {
          queue.push(resolved);
        }
      },
    });
  }

  return [...reachableFiles].sort();
}

function getParamInfo(param, index) {
  if (param.type === "Identifier") {
    return {
      index,
      name: param.name,
      hasDefault: false,
      isRest: false,
      isSimple: true,
    };
  }
  if (param.type === "AssignmentPattern" && param.left.type === "Identifier") {
    return {
      index,
      name: param.left.name,
      hasDefault: true,
      isRest: false,
      isSimple: true,
    };
  }
  if (param.type === "RestElement" && param.argument.type === "Identifier") {
    return {
      index,
      name: param.argument.name,
      hasDefault: false,
      isRest: true,
      isSimple: true,
    };
  }
  return {
    index,
    name: "<complex>",
    hasDefault: false,
    isRest: false,
    isSimple: false,
  };
}

function isTopLevel(pathLike) {
  if (pathLike.parentPath?.isProgram()) return true;
  return (
    (pathLike.parentPath?.isExportNamedDeclaration() ||
      pathLike.parentPath?.isExportDefaultDeclaration()) &&
    pathLike.parentPath.parentPath?.isProgram()
  );
}

function isTopLevelVariableDeclarator(variablePath) {
  if (!variablePath.parentPath?.isVariableDeclaration()) return false;
  return isTopLevel(variablePath.parentPath);
}

function createFunctionRecord({ id, name, filePath, path: functionPath, kind, ownerClass = null }) {
  const params = functionPath.node.params.map((param, index) => {
    const info = getParamInfo(param, index);
    let referenceCount = null;
    if (info.isSimple) {
      const binding = functionPath.scope.getBinding(info.name);
      referenceCount = binding?.referencePaths.length ?? 0;
    }
    return { ...info, referenceCount };
  });

  return {
    id,
    name,
    ownerClass,
    kind,
    filePath,
    loc: getLocation(functionPath.node),
    params,
    calls: [],
  };
}

function collectFileInfo(filePath) {
  const ast = parseFile(filePath);
  const imports = new Map();
  const topLevelFunctions = new Map();
  const classes = new Map();
  const exports = new Map();
  const functions = [];

  function addFunction(record) {
    functions.push(record);
    return record;
  }

  traverse(ast, {
    FunctionDeclaration(functionPath) {
      if (!isTopLevel(functionPath)) return;
      if (!functionPath.node.id?.name) return;
      const name = functionPath.node.id.name;
      const id = `${toProjectPath(filePath)}::${name}`;
      topLevelFunctions.set(name, id);
      addFunction(
        createFunctionRecord({
          id,
          name,
          filePath,
          path: functionPath,
          kind: "function",
        }),
      );
    },
    VariableDeclarator(variablePath) {
      if (!isTopLevelVariableDeclarator(variablePath)) return;
      if (variablePath.node.id.type !== "Identifier") return;
      const init = variablePath.node.init;
      if (!init) return;
      if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") return;
      const name = variablePath.node.id.name;
      const id = `${toProjectPath(filePath)}::${name}`;
      topLevelFunctions.set(name, id);
      addFunction(
        createFunctionRecord({
          id,
          name,
          filePath,
          path: variablePath.get("init"),
          kind: "function",
        }),
      );
    },
    ClassDeclaration(classPath) {
      if (!isTopLevel(classPath)) return;
      if (!classPath.node.id?.name) return;
      const className = classPath.node.id.name;
      const classId = `${toProjectPath(filePath)}::${className}`;
      const methods = new Map();
      classes.set(className, { id: classId, methods });

      for (const bodyPath of classPath.get("body.body")) {
        if (!bodyPath.isClassMethod() && !bodyPath.isClassPrivateMethod()) continue;
        if (bodyPath.node.computed) continue;
        if (bodyPath.node.key.type !== "Identifier") continue;
        const methodName = bodyPath.node.key.name;
        const methodId = `${classId}.${methodName}`;
        methods.set(methodName, methodId);
        addFunction(
          createFunctionRecord({
            id: methodId,
            name: methodName,
            ownerClass: className,
            filePath,
            path: bodyPath,
            kind: "method",
          }),
        );
      }

      for (const bodyPath of classPath.get("body.body")) {
        if (!bodyPath.isClassProperty()) continue;
        if (bodyPath.node.computed) continue;
        if (bodyPath.node.key.type !== "Identifier") continue;
        const valuePath = bodyPath.get("value");
        if (!valuePath.isArrowFunctionExpression() && !valuePath.isFunctionExpression()) continue;
        const methodName = bodyPath.node.key.name;
        const methodId = `${classId}.${methodName}`;
        methods.set(methodName, methodId);
        addFunction(
          createFunctionRecord({
            id: methodId,
            name: methodName,
            ownerClass: className,
            filePath,
            path: valuePath,
            kind: "method",
          }),
        );
      }
    },
    ImportDeclaration(importPath) {
      const source = importPath.node.source.value;
      const resolvedSource = resolveImport(filePath, source);
      for (const specifierPath of importPath.get("specifiers")) {
        if (specifierPath.isImportSpecifier()) {
          imports.set(specifierPath.node.local.name, {
            kind: "named",
            source,
            resolvedSource,
            importedName: specifierPath.node.imported.name,
          });
        } else if (specifierPath.isImportDefaultSpecifier()) {
          imports.set(specifierPath.node.local.name, {
            kind: "default",
            source,
            resolvedSource,
            importedName: "default",
          });
        } else if (specifierPath.isImportNamespaceSpecifier()) {
          imports.set(specifierPath.node.local.name, {
            kind: "namespace",
            source,
            resolvedSource,
            importedName: "*",
          });
        }
      }
    },
    ExportNamedDeclaration(exportPath) {
      const declaration = exportPath.node.declaration;
      if (declaration?.type === "FunctionDeclaration" && declaration.id?.name) {
        exports.set(declaration.id.name, { kind: "function", localName: declaration.id.name });
      }
      if (declaration?.type === "ClassDeclaration" && declaration.id?.name) {
        exports.set(declaration.id.name, { kind: "class", localName: declaration.id.name });
      }
      for (const specifier of exportPath.node.specifiers) {
        if (specifier.type !== "ExportSpecifier") continue;
        exports.set(specifier.exported.name, {
          kind: "reexport-local",
          localName: specifier.local.name,
        });
      }
    },
    ExportDefaultDeclaration(exportPath) {
      const declaration = exportPath.node.declaration;
      if (declaration.type === "FunctionDeclaration" && declaration.id?.name) {
        exports.set("default", { kind: "function", localName: declaration.id.name });
      } else if (declaration.type === "ClassDeclaration" && declaration.id?.name) {
        exports.set("default", { kind: "class", localName: declaration.id.name });
      } else if (declaration.type === "Identifier") {
        exports.set("default", { kind: "local", localName: declaration.name });
      }
    },
  });

  return {
    filePath,
    ast,
    imports,
    exports,
    topLevelFunctions,
    classes,
    functions,
  };
}

function resolveImportedSymbol(filesByPath, fileInfo, localName) {
  const imported = fileInfo.imports.get(localName);
  if (!imported?.resolvedSource) return null;
  const sourceFile = filesByPath.get(imported.resolvedSource);
  if (!sourceFile) return null;
  const exported = sourceFile.exports.get(imported.importedName);
  if (!exported) return null;

  if (
    exported.kind === "function" ||
    exported.kind === "local" ||
    exported.kind === "reexport-local"
  ) {
    const functionId = sourceFile.topLevelFunctions.get(exported.localName);
    if (functionId) {
      return { kind: "function", id: functionId };
    }
  }

  if (
    exported.kind === "class" ||
    exported.kind === "local" ||
    exported.kind === "reexport-local"
  ) {
    const classInfo = sourceFile.classes.get(exported.localName);
    if (classInfo) {
      return { kind: "class", id: classInfo.id, methods: classInfo.methods };
    }
  }

  return null;
}

function resolveIdentifierFunction(filesByPath, fileInfo, scope, localName) {
  const binding = scope.getBinding(localName);
  if (!binding) return resolveImportedSymbol(filesByPath, fileInfo, localName);

  if (binding.path.isImportSpecifier() || binding.path.isImportDefaultSpecifier()) {
    return resolveImportedSymbol(filesByPath, fileInfo, localName);
  }

  if (binding.path.isFunctionDeclaration() || binding.path.isVariableDeclarator()) {
    const functionId = fileInfo.topLevelFunctions.get(localName);
    if (functionId) {
      return { kind: "function", id: functionId };
    }
  }

  return null;
}

function resolveFunctionCallee(filesByPath, fileInfo, callPath, calleePath) {
  if (!calleePath.isIdentifier()) return null;
  return resolveIdentifierFunction(filesByPath, fileInfo, callPath.scope, calleePath.node.name);
}

function resolveClassFromIdentifier(filesByPath, fileInfo, callPath, identifierName) {
  const binding = callPath.scope.getBinding(identifierName);
  if (!binding) return resolveImportedSymbol(filesByPath, fileInfo, identifierName);

  if (binding.path.isImportSpecifier() || binding.path.isImportDefaultSpecifier()) {
    return resolveImportedSymbol(filesByPath, fileInfo, identifierName);
  }

  if (binding.path.isClassDeclaration()) {
    return fileInfo.classes.get(identifierName)
      ? { kind: "class", ...fileInfo.classes.get(identifierName) }
      : null;
  }

  return null;
}

function getVariableDeclaratorFromBinding(binding) {
  if (!binding?.path) return null;
  if (binding.path.isVariableDeclarator()) return binding.path;
  return binding.path.findParent((parentPath) => parentPath.isVariableDeclarator()) ?? null;
}

function getReturnedPath(functionPath) {
  if (functionPath.isArrowFunctionExpression() && !functionPath.get("body").isBlockStatement()) {
    return functionPath.get("body");
  }

  if (!functionPath.get("body").isBlockStatement()) return null;
  for (const statementPath of functionPath.get("body.body")) {
    if (statementPath.isReturnStatement()) {
      return statementPath.get("argument");
    }
  }
  return null;
}

function resolveInstantiatedClassFromInit(filesByPath, fileInfo, callPath, initPath) {
  if (!initPath?.node) return null;

  if (initPath.isNewExpression()) {
    const calleePath = initPath.get("callee");
    if (!calleePath.isIdentifier()) return null;
    return resolveClassFromIdentifier(filesByPath, fileInfo, callPath, calleePath.node.name);
  }

  if (!initPath.isCallExpression()) return null;
  const calleePath = initPath.get("callee");
  if (!calleePath.isIdentifier()) return null;
  if (!["useState", "useRef", "useMemo"].includes(calleePath.node.name)) return null;

  const [firstArgPath] = initPath.get("arguments");
  if (!firstArgPath?.node) return null;
  if (firstArgPath.isNewExpression()) {
    return resolveInstantiatedClassFromInit(filesByPath, fileInfo, callPath, firstArgPath);
  }
  if (!firstArgPath.isArrowFunctionExpression() && !firstArgPath.isFunctionExpression())
    return null;
  const returnedPath = getReturnedPath(firstArgPath);
  if (!returnedPath?.node) return null;
  return resolveInstantiatedClassFromInit(filesByPath, fileInfo, callPath, returnedPath);
}

function resolveClassInstanceFromExpression(filesByPath, fileInfo, callPath, expressionPath) {
  if (!expressionPath?.node) return null;

  if (expressionPath.isIdentifier()) {
    const binding = callPath.scope.getBinding(expressionPath.node.name);
    const variableDeclaratorPath = getVariableDeclaratorFromBinding(binding);
    if (!variableDeclaratorPath) return null;
    return resolveInstantiatedClassFromInit(
      filesByPath,
      fileInfo,
      callPath,
      variableDeclaratorPath.get("init"),
    );
  }

  if (expressionPath.isNewExpression() || expressionPath.isCallExpression()) {
    return resolveInstantiatedClassFromInit(filesByPath, fileInfo, callPath, expressionPath);
  }

  return null;
}

function getEnclosingTopLevelFunctionId(fileInfo, pathLike) {
  for (let currentPath = pathLike; currentPath; currentPath = currentPath.parentPath) {
    const isFunctionLike =
      currentPath.isFunctionDeclaration() ||
      currentPath.isFunctionExpression() ||
      currentPath.isArrowFunctionExpression();
    if (!isFunctionLike) continue;

    if (currentPath.isFunctionDeclaration() && currentPath.node.id?.name) {
      const functionId = fileInfo.topLevelFunctions.get(currentPath.node.id.name);
      if (functionId) return functionId;
    }

    const variableDeclaratorPath = currentPath.findParent((parentPath) =>
      parentPath.isVariableDeclarator(),
    );
    if (
      variableDeclaratorPath?.node.id.type === "Identifier" &&
      isTopLevelVariableDeclarator(variableDeclaratorPath)
    ) {
      const functionId = fileInfo.topLevelFunctions.get(variableDeclaratorPath.node.id.name);
      if (functionId) return functionId;
    }
  }

  return null;
}

function getComponentPropNameFromBinding(binding) {
  if (!binding?.identifier?.name) return null;
  const parentPath = binding.path.parentPath;

  if (parentPath?.isObjectProperty() && parentPath.parentPath?.isObjectPattern()) {
    const key = parentPath.node.key;
    if (key.type === "Identifier") return key.name;
    if (key.type === "StringLiteral") return key.value;
  }

  if (binding.path.listKey === "params") {
    return binding.identifier.name;
  }

  return null;
}

function noteComponentPropClass(componentPropClasses, functionId, propName, resolvedClass) {
  if (!functionId || !propName || !resolvedClass?.id) return;
  let propsForFunction = componentPropClasses.get(functionId);
  if (!propsForFunction) {
    propsForFunction = new Map();
    componentPropClasses.set(functionId, propsForFunction);
  }
  const existing = propsForFunction.get(propName);
  if (!existing) {
    propsForFunction.set(propName, resolvedClass);
    return;
  }
  if (existing.id !== resolvedClass.id) {
    propsForFunction.set(propName, null);
  }
}

function collectComponentPropClasses(filesByPath) {
  const componentPropClasses = new Map();

  for (const fileInfo of filesByPath.values()) {
    traverse(fileInfo.ast, {
      JSXOpeningElement(elementPath) {
        const namePath = elementPath.get("name");
        if (!namePath.isJSXIdentifier()) return;
        const componentName = namePath.node.name;
        if (!/^[A-Z]/.test(componentName)) return;
        const resolvedFunction = resolveIdentifierFunction(
          filesByPath,
          fileInfo,
          elementPath.scope,
          componentName,
        );
        if (!resolvedFunction?.id) return;

        for (const attributePath of elementPath.get("attributes")) {
          if (!attributePath.isJSXAttribute()) continue;
          if (!attributePath.get("name").isJSXIdentifier()) continue;
          const valuePath = attributePath.get("value");
          if (!valuePath.isJSXExpressionContainer()) continue;
          const resolvedClass = resolveClassInstanceFromExpression(
            filesByPath,
            fileInfo,
            elementPath,
            valuePath.get("expression"),
          );
          if (!resolvedClass?.methods) continue;
          noteComponentPropClass(
            componentPropClasses,
            resolvedFunction.id,
            attributePath.node.name.name,
            resolvedClass,
          );
        }
      },
    });
  }

  return componentPropClasses;
}

function resolveMethodFromComponentProp(
  componentPropClasses,
  fileInfo,
  callPath,
  binding,
  methodName,
) {
  const functionId = getEnclosingTopLevelFunctionId(fileInfo, callPath);
  if (!functionId) return null;
  const propName = getComponentPropNameFromBinding(binding);
  if (!propName) return null;
  const propsForFunction = componentPropClasses.get(functionId);
  const resolvedClass = propsForFunction?.get(propName);
  if (!resolvedClass?.methods) return null;
  const methodId = resolvedClass.methods.get(methodName);
  if (!methodId) return null;
  return { kind: "method", id: methodId };
}

function resolveMethodCallee(filesByPath, fileInfo, componentPropClasses, callPath, calleePath) {
  if (!calleePath.isMemberExpression()) return null;
  if (calleePath.node.computed) return null;
  const property = calleePath.get("property");
  const object = calleePath.get("object");
  if (!property.isIdentifier()) return null;

  if (object.isThisExpression()) {
    const classPath = callPath.findParent((parentPath) => parentPath.isClassDeclaration());
    if (!classPath?.node?.id?.name) return null;
    const classInfo = fileInfo.classes.get(classPath.node.id.name);
    if (!classInfo) return null;
    const methodId = classInfo.methods.get(property.node.name);
    if (!methodId) return null;
    return { kind: "method", id: methodId };
  }

  if (!object.isIdentifier()) return null;

  const binding = callPath.scope.getBinding(object.node.name);
  const resolvedFromProp = resolveMethodFromComponentProp(
    componentPropClasses,
    fileInfo,
    callPath,
    binding,
    property.node.name,
  );
  if (resolvedFromProp) return resolvedFromProp;
  const variableDeclaratorPath = getVariableDeclaratorFromBinding(binding);
  if (!variableDeclaratorPath) return null;
  const initPath = variableDeclaratorPath.get("init");
  const resolvedClass = resolveInstantiatedClassFromInit(filesByPath, fileInfo, callPath, initPath);
  if (!resolvedClass?.methods) return null;
  const methodId = resolvedClass.methods.get(property.node.name);
  if (!methodId) return null;
  return { kind: "method", id: methodId };
}

function describeArguments(args) {
  const firstSpreadIndex = args.findIndex((arg) => arg.type === "SpreadElement");
  return {
    count: args.length,
    hasSpread: firstSpreadIndex >= 0,
    firstSpreadIndex,
    omittedIndexes: args.flatMap((arg, index) => {
      if (arg.type === "Identifier" && arg.name === "undefined") {
        return [index];
      }
      if (arg.type === "UnaryExpression" && arg.operator === "void") {
        return [index];
      }
      return [];
    }),
  };
}

function describeJsxAttributes(attributes) {
  const firstSpreadIndex = attributes.findIndex(
    (attribute) => attribute.type === "JSXSpreadAttribute",
  );
  return {
    count: 1,
    hasSpread: firstSpreadIndex >= 0,
    firstSpreadIndex: firstSpreadIndex >= 0 ? 0 : -1,
    omittedIndexes: [],
  };
}

function collectCalls(filesByPath, functionById) {
  const componentPropClasses = collectComponentPropClasses(filesByPath);

  for (const fileInfo of filesByPath.values()) {
    traverse(fileInfo.ast, {
      CallExpression(callPath) {
        const calleePath = callPath.get("callee");
        const resolved =
          resolveFunctionCallee(filesByPath, fileInfo, callPath, calleePath) ??
          resolveMethodCallee(filesByPath, fileInfo, componentPropClasses, callPath, calleePath);
        if (!resolved) return;
        const functionRecord = functionById.get(resolved.id);
        if (!functionRecord) return;
        functionRecord.calls.push({
          filePath: fileInfo.filePath,
          loc: getLocation(callPath.node),
          ...describeArguments(callPath.node.arguments),
        });
      },
      NewExpression(newPath) {
        const resolved = resolveFunctionCallee(
          filesByPath,
          fileInfo,
          newPath,
          newPath.get("callee"),
        );
        if (!resolved) return;
        const functionRecord = functionById.get(resolved.id);
        if (!functionRecord) return;
        functionRecord.calls.push({
          filePath: fileInfo.filePath,
          loc: getLocation(newPath.node),
          ...describeArguments(newPath.node.arguments ?? []),
          via: "new",
        });
      },
      JSXOpeningElement(elementPath) {
        const namePath = elementPath.get("name");
        if (!namePath.isJSXIdentifier()) return;
        const componentName = namePath.node.name;
        if (!/^[A-Z]/.test(componentName)) return;
        const resolved = resolveIdentifierFunction(
          filesByPath,
          fileInfo,
          elementPath.scope,
          componentName,
        );
        if (!resolved) return;
        const functionRecord = functionById.get(resolved.id);
        if (!functionRecord) return;
        functionRecord.calls.push({
          filePath: fileInfo.filePath,
          loc: getLocation(elementPath.node),
          ...describeJsxAttributes(elementPath.node.attributes),
          via: "jsx",
        });
      },
    });
  }
}

function buildFindings(functions) {
  const findings = [];

  for (const fn of functions) {
    for (const param of fn.params) {
      if (!param.isSimple || param.isRest) continue;
      if (param.index >= fn.calls.length && fn.calls.length === 0) {
        continue;
      }

      let hasUnknownCall = false;
      let isEverPassed = false;
      let isOnlyPassedAsUndefined = false;

      for (const call of fn.calls) {
        if (call.hasSpread && call.firstSpreadIndex <= param.index) {
          hasUnknownCall = true;
          continue;
        }
        if (call.count <= param.index) {
          continue;
        }
        if (call.omittedIndexes.includes(param.index)) {
          isOnlyPassedAsUndefined = true;
          continue;
        }
        isEverPassed = true;
      }

      if (hasUnknownCall || isEverPassed) continue;

      findings.push({
        type: param.referenceCount === 0 ? "never-passed-and-unused" : "never-passed",
        functionId: fn.id,
        functionName: fn.name,
        ownerClass: fn.ownerClass,
        filePath: fn.filePath,
        functionLoc: fn.loc,
        paramName: param.name,
        paramIndex: param.index,
        paramHasDefault: param.hasDefault,
        paramReferenceCount: param.referenceCount,
        callCount: fn.calls.length,
        onlyExplicitUndefined: isOnlyPassedAsUndefined,
        calls: fn.calls.map((call) => ({
          filePath: call.filePath,
          loc: call.loc,
          count: call.count,
          hasSpread: call.hasSpread,
        })),
      });
    }
  }

  findings.sort((left, right) => {
    const leftPath = toProjectPath(left.filePath);
    const rightPath = toProjectPath(right.filePath);
    if (leftPath !== rightPath) return leftPath.localeCompare(rightPath);
    if (left.functionLoc.line !== right.functionLoc.line) {
      return left.functionLoc.line - right.functionLoc.line;
    }
    return left.paramIndex - right.paramIndex;
  });

  return findings;
}

function toSerializableGraph(functions) {
  return functions.map((fn) => ({
    id: fn.id,
    name: fn.name,
    ownerClass: fn.ownerClass,
    kind: fn.kind,
    filePath: toProjectPath(fn.filePath),
    loc: fn.loc,
    params: fn.params,
    calls: fn.calls.map((call) => ({
      filePath: toProjectPath(call.filePath),
      loc: call.loc,
      count: call.count,
      hasSpread: call.hasSpread,
      firstSpreadIndex: call.firstSpreadIndex,
      omittedIndexes: call.omittedIndexes,
      via: call.via ?? "call",
    })),
  }));
}

function writeJson(fileName, value) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function logFindings(findings) {
  if (findings.length === 0) {
    console.log("No high-confidence never-passed parameters found.");
    return;
  }

  console.log(`Found ${findings.length} high-confidence parameter cleanup candidates:\n`);
  for (const finding of findings) {
    const owner = finding.ownerClass ? `${finding.ownerClass}.` : "";
    const typeLabel =
      finding.type === "never-passed-and-unused" ? "never passed and unused" : "never passed";
    const undefinedLabel = finding.onlyExplicitUndefined ? " (only explicit undefined seen)" : "";
    console.log(
      `${typeLabel}: ${owner}${finding.functionName} parameter #${finding.paramIndex + 1} ` +
        `\`${finding.paramName}\` at ${toProjectPath(finding.filePath)}:${finding.functionLoc.line}${undefinedLabel}`,
    );
    for (const call of finding.calls) {
      console.log(
        `  call: ${toProjectPath(call.filePath)}:${call.loc.line}:${call.loc.column} args=${call.count}`,
      );
    }
    console.log("");
  }
}

function main() {
  const reachableFiles = collectReachableFiles(entryFile);
  const filesByPath = new Map(
    reachableFiles.map((filePath) => [filePath, collectFileInfo(filePath)]),
  );
  const functions = [...filesByPath.values()].flatMap((fileInfo) => fileInfo.functions);
  const functionById = new Map(functions.map((fn) => [fn.id, fn]));

  collectCalls(filesByPath, functionById);

  const findings = buildFindings(functions);
  writeJson("graph.json", toSerializableGraph(functions));
  writeJson(
    "findings.json",
    findings.map((finding) => ({
      ...finding,
      filePath: toProjectPath(finding.filePath),
      calls: finding.calls.map((call) => ({
        ...call,
        filePath: toProjectPath(call.filePath),
      })),
    })),
  );

  console.log(
    `Analyzed ${reachableFiles.length} reachable files from ${toProjectPath(entryFile)}.`,
  );
  console.log(`Wrote ${toProjectPath(path.join(outputDir, "graph.json"))}.`);
  console.log(`Wrote ${toProjectPath(path.join(outputDir, "findings.json"))}.\n`);
  logFindings(findings);
}

main();
