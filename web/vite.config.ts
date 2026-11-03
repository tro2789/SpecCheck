import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset URLs: the site is served at a domain root and also
  // proxied under a subpath (trevorohare.com/spec-check/).
  base: "./",
  worker: { format: "es" },
  build: { outDir: "dist", target: "es2022" },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    execArgv: ["--expose-gc"],
  },
});
