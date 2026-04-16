import { defineConfig } from "vitest/config";
import { vitestAlias, vitestCommonExclude } from "./vitest.shared";

export default defineConfig({
  resolve: {
    alias: vitestAlias,
  },
  test: {
    environment: "node",
    exclude: vitestCommonExclude,
    fileParallelism: false,
    include: ["src/**/*.smoke.test.ts"],
    maxWorkers: 1,
  },
});
