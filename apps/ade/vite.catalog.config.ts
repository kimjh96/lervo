import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The design system catalog: a page outside the app bundle, for review and for the site's
// examples. `pnpm catalog` serves it; the app's build never includes it.
export default defineConfig({
  root: "catalog",
  // Its own dependency cache, so the catalog and the app's dev server can run side by side.
  cacheDir: "../node_modules/.vite-catalog",
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: [
      {
        find: /^@formatjs\/icu-messageformat-parser$/u,
        replacement: "@formatjs/icu-messageformat-parser/no-parser.js",
      },
    ],
  },
  server: { port: 1421, strictPort: true },
  build: { target: "safari16", outDir: "../dist-catalog", emptyOutDir: true },
});
