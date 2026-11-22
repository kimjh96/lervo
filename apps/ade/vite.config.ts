import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Tauri shell loads the dev server on a fixed port and the built assets from dist/.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: [
      // Catalogs are compiled to ASTs at build time, so the runtime parser stays out of the bundle.
      {
        find: /^@formatjs\/icu-messageformat-parser$/u,
        replacement: "@formatjs/icu-messageformat-parser/no-parser.js",
      },
    ],
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "safari16",
    outDir: "dist",
  },
});
