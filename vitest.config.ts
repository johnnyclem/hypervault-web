import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    env: { SMALLCHAT_DISABLE_LOCAL_ONNX: "1" },
  },
});
