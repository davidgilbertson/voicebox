/** @type {import("vitest/config").UserConfig} */
module.exports = {
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["test/setup.js"],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    include: ["test/**/*.test.{js,jsx}"],
    pool: "threads",
    maxWorkers: 1,
  },
};
