/** @type {import("vitest/config").UserConfig} */
module.exports = {
  esbuild: {
    jsx: "automatic",
  },
  test: {
    projects: [
      {
        extends: true,
        esbuild: {
          jsx: "automatic",
        },
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["test/dom/setup.dom.js"],
          include: ["test/dom/**/*.test.{js,jsx}"],
          clearMocks: true,
          restoreMocks: true,
          unstubGlobals: true,
          pool: "threads",
          maxWorkers: 1,
        },
      },
      {
        extends: true,
        esbuild: {
          jsx: "automatic",
        },
        test: {
          name: "unit",
          environment: "node",
          setupFiles: ["test/unit/setup.unit.js"],
          include: ["test/unit/**/*.test.{js,jsx}"],
          clearMocks: true,
          restoreMocks: true,
          unstubGlobals: true,
          pool: "threads",
          maxWorkers: 1,
        },
      },
    ],
  },
};
