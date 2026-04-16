import { fileURLToPath } from "node:url";

export const vitestAlias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

export const vitestCommonExclude = ["node_modules/**", ".next/**", "output/**"];
