import js from "@eslint/js";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import globals from "globals";

// The agent-rules plugin lives in a sibling directory and is intentionally NOT a
// package.json dependency, so `npm install` works on build servers that only check
// out this repo. When the sibling dir is absent (e.g. CI), the rules are skipped.
const agentRulesPath = new URL("../eslint-plugin-agent-rules/index.js", import.meta.url);
const agentRules = existsSync(agentRulesPath)
  ? (await import(agentRulesPath.href)).default
  : undefined;

export default [
  js.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", ".private/**", "experiments/**"],
  },
  ...(agentRules
    ? [
        {
          plugins: {
            "agent-rules": agentRules,
          },
          rules: {
            "agent-rules/no-low-value-local-function": "error",
          },
        },
      ]
    : []),
  {
    files: ["src/**/*.js", "src/**/*.jsx", "test/**/*.js", "test/**/*.jsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        // Custom build globals
        __BUILD_TIME_SYDNEY__: "readonly",
        // Vitest globals
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        vi: "readonly",
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  {
    files: ["src/**/*.js", "src/**/*.jsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration",
          message: "Prefer named exports over default exports.",
        },
      ],
    },
  },
];
