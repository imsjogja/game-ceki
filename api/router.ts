import { authRouter } from "./auth-router";
import { rummyRouter } from "./rummy-router";
import { voiceRouter } from "./voice-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  rummy: rummyRouter,
  voice: voiceRouter,
});

export type AppRouter = typeof appRouter;
