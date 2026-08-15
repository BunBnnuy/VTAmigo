import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/respond": "http://localhost:3001",
      "/connect": "http://localhost:3001",
      "/disconnect": "http://localhost:3001",
      "/health": "http://localhost:3001",
      "/event-response": "http://localhost:3001",
      "/reddit-story": "http://localhost:3001",
      "/reddit-thoughts": "http://localhost:3001",
      "/vtube": "http://localhost:3001",
      "/lipsync": "http://localhost:3001",
      "/transcribe": "http://localhost:3001",
      "/youtube-narrate": "http://localhost:3001",
      "/connect-tiktok": "http://localhost:3001",
      "/disconnect-tiktok": "http://localhost:3001",
      "/connect-bot": "http://localhost:3001",
      "/say": "http://localhost:3001",
      "/screenwatch": "http://localhost:3001",
      "/screen-answer": "http://localhost:3001",
      "/xp": "http://localhost:3001",
      "/tts": "http://localhost:3001",
      "/memory": "http://localhost:3001",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.js"],
    include: ["test/**/*.test.{js,jsx}"],
  },
});
