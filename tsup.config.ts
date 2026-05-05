import { defineConfig } from "tsup";

// IIFE bundle for browser <script> tags.  Exposes window.RunJobs
// as a constructor (alias for RunJobsClient) plus the namespace.
//
//   <script src="https://cdn.jsdelivr.net/npm/@runjobsai/sdk/dist/sdk.umd.js"></script>
//   <script>
//     const client = new RunJobs.Client({ authProvider: "runjobs" });
//   </script>
export default defineConfig({
  entry: { sdk: "src/index.ts" },
  format: ["iife"],
  globalName: "RunJobs",
  sourcemap: true,
  minify: true,
  clean: false, // tsc has already produced ESM; don't wipe it
  target: "es2020",
  platform: "browser",
  outExtension: () => ({ js: ".umd.js" }),
});
