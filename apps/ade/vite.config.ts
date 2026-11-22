import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Tauri shell loads the dev server on a fixed port and the built assets from dist/.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "safari16",
    outDir: "dist",
  },
});
