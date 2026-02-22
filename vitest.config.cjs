/** @type {import("vitest/config").UserConfig} */
module.exports = {
  esbuild: {
    jsx: "automatic",
    define: {
      __BUILD_TIME_SYDNEY__: "\"Jan 1, 1970, 12:00 AM\"",
    },
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
