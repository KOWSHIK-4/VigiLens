import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.vitest.test.ts"],
    testTimeout: 15_000,
    reporters: ["verbose"],
  },
});
