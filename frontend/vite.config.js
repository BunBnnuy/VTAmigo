import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // The VRM lab is a standalone page, not a client-side route: giving it
      // its own entry keeps three.js and @pixiv/three-vrm out of the main
      // app bundle (see src/vrmLab/main.jsx).
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        vrmLab: fileURLToPath(new URL("./vrm-lab.html", import.meta.url)),
        vrmOverlay: fileURLToPath(new URL("./vrm-overlay.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/respond": "http://localhost:3001",
      "/connect": "http://localhost:3001",
      "/disconnect": "http://localhost:3001",
      "/health": "http://localhost:3001",
      "/event-response": "http://localhost:3001",
      "/avatar": "http://localhost:3001",
      "/connect-tiktok": "http://localhost:3001",
      "/disconnect-tiktok": "http://localhost:3001",
      "/connect-bot": "http://localhost:3001",
      "/say": "http://localhost:3001",
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
