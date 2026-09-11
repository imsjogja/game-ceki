import { authRouter } from "./auth-router";
import { rummyRouter } from "./rummy-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  rummy: rummyRouter,
});

export type AppRouter = typeof appRouter;
