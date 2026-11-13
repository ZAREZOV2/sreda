import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 1420, strictPort: true, fs: { allow: [repoRoot] } },
  build: { outDir: "dist" },
  clearScreen: false,
});
