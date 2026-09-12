import devServer from "@hono/vite-dev-server";
import path from "path";
const __dirname = import.meta.dirname;
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const voiceGatewayPlugin: Plugin = {
  name: "remiku-voice-gateway",
  configureServer(server) {
    const httpServer = server.httpServer;
    if (!httpServer) return;

    // ssrLoadModule memakai alias Vite yang sama dengan backend development.
    // Gateway hanya memproses /api/voice sehingga upgrade HMR Vite tetap aman.
    void server
      .ssrLoadModule("/api/voice-router.ts")
      .then(({ installVoiceGateway }) => {
        const gateway = installVoiceGateway(httpServer);
        httpServer.once("close", () => gateway.close());
      })
      .catch((error: unknown) => {
        console.error("[voice] gagal memasang WebSocket gateway:", error);
      });
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    voiceGatewayPlugin,
    react(),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      db: path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
