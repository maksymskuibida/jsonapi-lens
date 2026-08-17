import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    // Fonts are self-hosted so the page makes zero third-party requests.
    assetsInlineLimit: 0,
  },
});
