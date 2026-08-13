import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const serverTarget = process.env.SERVER_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Read the shared package straight from source in dev (no build step).
      "@ast/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: serverTarget, changeOrigin: true },
      "/ws": { target: serverTarget, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
