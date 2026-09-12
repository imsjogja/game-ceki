import { createServer } from "node:http";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import {
  createGoogleAuthStartHandler,
  createGoogleOAuthCallbackHandler,
} from "./auth/google";
import { Paths } from "@contracts/constants";
import { installGameGateway } from "./game-router";
import { installVoiceGateway } from "./voice-router";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.googleAuthStart, createGoogleAuthStartHandler());
app.get(Paths.googleOAuthCallback, createGoogleOAuthCallbackHandler());
app.use("/api/trpc/*", async c => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", c => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serveStaticFiles } = await import("./lib/vite");
  const { ensureSchema } = await import("./queries/ensure-schema");
  serveStaticFiles(app);

  try {
    await ensureSchema();
  } catch (e) {
    console.error("[db] ensureSchema gagal (server tetap jalan):", e);
  }

  const port = parseInt(process.env.PORT || "3000");
  const server = createServer(getRequestListener(app.fetch));
  installGameGateway(server);
  installVoiceGateway(server);
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
