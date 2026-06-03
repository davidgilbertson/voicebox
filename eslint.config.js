import js from "@eslint/js";
// import agentRules from "@david/eslint-plugin-agent-rules";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", ".private/**", "experiments/**"],
  },
  // {
  //   plugins: {
  //     "agent-rules": agentRules,
  //   },
  //   rules: {
  //     "agent-rules/no-date-footguns": "error",
  //     "agent-rules/no-low-value-local-function": "error",
  //   },
  // },
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
