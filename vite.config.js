import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3088",
      "/socket.io": { target: "http://127.0.0.1:3088", ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
