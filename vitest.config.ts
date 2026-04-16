import { defineConfig } from "vitest/config";

import { vitestAlias, vitestCommonExclude } from "./vitest.shared";

export default defineConfig({
  resolve: {
    alias: vitestAlias,
  },
  test: {
    environment: "node",
    exclude: [...vitestCommonExclude, "src/**/*.smoke.test.ts"],
    include: ["src/**/*.test.ts"],
  },
});
