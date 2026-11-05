import { defineConfig } from "vite"; import react from "@vitejs/plugin-react"; import { readFileSync } from "node:fs";
// the backend writes the port it actually got (default 5050; port 5000 is often taken by Docker/WSL on Windows)
let port = process.env.BACKEND_PORT || "5050"; try { port = readFileSync(new URL("./.backend-port", import.meta.url), "utf8").trim() || port; } catch {}
export default defineConfig({ plugins: [react()], server: { proxy: { "/api": { target: `http://127.0.0.1:${port}`, ws: true } } } });
