import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["onnxruntime-node", "onnxruntime-web"],
  // backend through a computed `import(/*webpackIgnore:true*/ path)` — a
  outputFileTracingIncludes: {
    "/api/chat": [
      "./lib/smallchat/models/**",
      "./node_modules/onnxruntime-web/dist/*.wasm",
      "./node_modules/onnxruntime-web/dist/ort-wasm-*.mjs",
    ],
    "/api/toolkits/compile": [
      "./lib/smallchat/models/**",
      "./node_modules/onnxruntime-web/dist/*.wasm",
      "./node_modules/onnxruntime-web/dist/ort-wasm-*.mjs",
    ],
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /[\\/]node_modules[\\/]pocket-tts-js[\\/].*\.js$/,
      loader: path.join(process.cwd(), "scripts/preserve-dynamic-import-loader.cjs"),
    });
    return config;
  },
};

export default nextConfig;
