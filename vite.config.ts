import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { type ConfigEnv, defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }: ConfigEnv) => {
  const env: Record<string, string> = loadEnv(mode, process.cwd(), "");
  const repo: string = env.GITHUB_REPO?.split("/").at(-1) ?? "atari-model-arena-ui";
  const isPages: boolean = mode === "pages";

  return {
    base: isPages ? `/${repo}/` : "/",
    plugins: [react()],
    worker: { format: "es" as const },
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
