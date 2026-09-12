import devServer from "@hono/vite-dev-server";
import path from "path";
const __dirname = import.meta.dirname;
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const realtimeGatewayPlugin: Plugin = {
  name: "remiku-realtime-gateways",
  configureServer(server) {
    const httpServer = server.httpServer;
    if (!httpServer) return;

    // ssrLoadModule memakai alias Vite yang sama dengan backend development.
    // Masing-masing gateway menyaring path sendiri, sehingga HMR Vite dan
    // endpoint /api/voice + /api/game dapat berbagi HTTP server yang sama.
    void Promise.all([
      server.ssrLoadModule("/api/game-router.ts"),
      server.ssrLoadModule("/api/voice-router.ts"),
    ])
      .then(([{ installGameGateway }, { installVoiceGateway }]) => {
        const gameGateway = installGameGateway(httpServer);
        const voiceGateway = installVoiceGateway(httpServer);
        httpServer.once("close", () => {
          gameGateway.close();
          voiceGateway.close();
        });
      })
      .catch((error: unknown) => {
        console.error("[realtime] gagal memasang WebSocket gateway:", error);
      });
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    realtimeGatewayPlugin,
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
