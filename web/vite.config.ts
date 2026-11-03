import { defineConfig } from "vitest/config";

export default defineConfig({
  // Public URL is https://www.trevorohare.com/spec-check (proxied to this
  // Vercel project by a rewrite in trevorohare.com). That site strips
  // trailing slashes, so asset URLs must be absolute under /spec-check/.
  // web/vercel.json maps /spec-check/* back to the files on this project.
  base: "/spec-check/",
  worker: { format: "es" },
  build: { outDir: "dist", target: "es2022" },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    execArgv: ["--expose-gc"],
  },
});
