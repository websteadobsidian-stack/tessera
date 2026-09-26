import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// В разработке API поднимается отдельно: uvicorn app.main:app --port 8000
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.TESSERA_API ?? "http://localhost:8000" },
  },
});
