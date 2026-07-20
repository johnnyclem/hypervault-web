import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["**/__tests__/**/*.test.ts"],
    env: { SMALLCHAT_DISABLE_LOCAL_ONNX: "1" },
  },
});
