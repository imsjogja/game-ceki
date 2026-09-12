import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { upsertUser } from "./queries/users";
import { signSessionToken } from "./auth/session";
import { isGoogleOAuthConfigured } from "./auth/google";

export const authRouter = createRouter({
  providers: publicQuery.query(() => ({
    google: isGoogleOAuthConfigured(),
  })),

  me: authedQuery.query((opts) => opts.ctx.user),

  // Login tamu: langsung masuk tanpa OAuth, identitas acak per sesi
  guest: publicQuery.mutation(async ({ ctx }) => {
    const unionId = `guest-${crypto.randomUUID()}`;
    const name = `Tamu-${Math.floor(1000 + Math.random() * 9000)}`;
    await upsertUser({ unionId, name, lastSignInAt: new Date() });
    const token = await signSessionToken({ unionId });
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, token, {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: Session.maxAgeMs / 1000,
      }),
    );
    return { name };
  }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),
});
