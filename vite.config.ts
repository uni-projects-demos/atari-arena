import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { type ConfigEnv, defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }: ConfigEnv) => {
  const env: Record<string, string> = loadEnv(mode, process.cwd(), "");
  const repo: string = env.GITHUB_REPO?.split("/").at(-1) ?? "atari-arena";
  const isPages: boolean = mode === "pages";

  return {
    base: isPages ? `/${repo}/` : "/",
    plugins: [react()],
    worker: { format: "es" as const },
    optimizeDeps: {
      include: [
        env.VITE_BROWSER_DEVICE === "webgpu" ? "onnxruntime-web/webgpu" : "onnxruntime-web/wasm",
      ],
      exclude: [
        env.VITE_BROWSER_DEVICE === "webgpu" ? "onnxruntime-web/wasm" : "onnxruntime-web/webgpu",
      ],
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
        "/ws": {
          target: "ws://localhost:8000",
          ws: true,
        },
      },
    },
  };
});
