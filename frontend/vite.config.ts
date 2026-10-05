/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 개발 서버: /api 요청을 nginx(docker compose)로 넘긴다
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.API_PROXY ?? "http://localhost:8088", changeOrigin: false },
    },
  },
  test: {
    environment: "node",
  },
});
