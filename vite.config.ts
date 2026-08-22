import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env: Record<string, string> = loadEnv(mode, process.cwd(), "");
  const repo: string = env.GITHUB_REPO?.split("/").at(-1) ?? "";
  const isPages: boolean = mode === "pages";
  const pagesBase: string = repo && !repo.endsWith(".github.io") ? `/${repo}/` : "/";

  return {
    base: isPages ? pagesBase : "/",
    plugins: [react()],
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
