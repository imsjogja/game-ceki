import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import * as cookie from "cookie";
import * as jose from "jose";
import { GoogleOAuth, Paths, Session } from "@contracts/constants";
import { env } from "../lib/env";
import { getSessionCookieOptions } from "../lib/cookies";
import { upsertUser } from "../queries/users";
import { signSessionToken } from "./session";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const googleJwks = jose.createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

type OAuthAttempt = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  id_token: string;
  scope: string;
  token_type: string;
};

type GoogleIdentity = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

function requireGoogleConfig() {
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new Error(
      "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
}

export function isGoogleOAuthConfigured() {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

function base64Url(bytes: number) {
  return randomBytes(bytes).toString("base64url");
}

function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function originsMatch(a: string, b: string) {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  return aBytes.length === bBytes.length && timingSafeEqual(aBytes, bBytes);
}

function getCallbackUri(headers: Headers) {
  if (env.appOrigin) return `${env.appOrigin}${Paths.googleOAuthCallback}`;

  const host = headers.get("host");
  if (!host) throw new Error("Unable to determine application origin.");
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (host.startsWith("localhost:") ? "http" : "https");
  return `${protocol}://${host}${Paths.googleOAuthCallback}`;
}

async function signOAuthAttempt(attempt: OAuthAttempt) {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT(attempt)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${GoogleOAuth.stateMaxAgeMs / 60_000}m`)
    .sign(secret);
}

async function verifyOAuthAttempt(token: string) {
  const secret = new TextEncoder().encode(env.appSecret);
  const { payload } = await jose.jwtVerify(token, secret, {
    algorithms: ["HS256"],
  });
  if (
    typeof payload.state !== "string" ||
    typeof payload.codeVerifier !== "string" ||
    typeof payload.redirectUri !== "string"
  ) {
    throw new Error("Invalid OAuth state.");
  }
  return {
    state: payload.state,
    codeVerifier: payload.codeVerifier,
    redirectUri: payload.redirectUri,
  } satisfies OAuthAttempt;
}

async function exchangeAuthorizationCode(
  code: string,
  attempt: OAuthAttempt,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    redirect_uri: attempt.redirectUri,
    grant_type: "authorization_code",
    code_verifier: attempt.codeVerifier,
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status}).`);
  }
  return response.json() as Promise<GoogleTokenResponse>;
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const { payload } = await jose.jwtVerify(idToken, googleJwks, {
    audience: env.googleClientId,
    issuer: GOOGLE_ISSUERS,
  });
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Google ID token does not contain a subject.");
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    email_verified:
      typeof payload.email_verified === "boolean"
        ? payload.email_verified
        : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}

function clearOAuthCookie(c: Context) {
  deleteCookie(c, GoogleOAuth.stateCookieName, {
    ...getSessionCookieOptions(c.req.raw.headers),
    path: Paths.googleAuthStart,
  });
}

export function createGoogleAuthStartHandler() {
  return async (c: Context) => {
    try {
      requireGoogleConfig();
      const state = base64Url(32);
      const codeVerifier = base64Url(48);
      const redirectUri = getCallbackUri(c.req.raw.headers);
      const signedAttempt = await signOAuthAttempt({
        state,
        codeVerifier,
        redirectUri,
      });

      setCookie(c, GoogleOAuth.stateCookieName, signedAttempt, {
        ...getSessionCookieOptions(c.req.raw.headers),
        path: Paths.googleAuthStart,
        maxAge: GoogleOAuth.stateMaxAgeMs / 1000,
      });

      const url = new URL(GOOGLE_AUTHORIZATION_URL);
      url.searchParams.set("client_id", env.googleClientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
      return c.redirect(url.toString(), 302);
    } catch (error) {
      console.error("[google-auth] Unable to start sign-in:", error);
      return c.text("Google sign-in is unavailable.", 503);
    }
  };
}

export function createGoogleOAuthCallbackHandler() {
  return async (c: Context) => {
    const error = c.req.query("error");
    if (error === "access_denied") return c.redirect(Paths.login, 302);
    if (error) return c.redirect(Paths.login, 302);

    const code = c.req.query("code");
    const state = c.req.query("state");
    const stateCookie = cookie.parse(c.req.header("cookie") || "")[
      GoogleOAuth.stateCookieName
    ];
    clearOAuthCookie(c);

    if (!code || !state || !stateCookie) {
      return c.text("Invalid Google sign-in response.", 400);
    }

    try {
      requireGoogleConfig();
      const attempt = await verifyOAuthAttempt(stateCookie);
      if (!originsMatch(state, attempt.state)) {
        return c.text("Invalid Google sign-in state.", 400);
      }

      const tokenResponse = await exchangeAuthorizationCode(code, attempt);
      const identity = await verifyGoogleIdToken(tokenResponse.id_token);
      const unionId = `google:${identity.sub}`;
      await upsertUser({
        unionId,
        name: identity.name || identity.email || "Pemain Google",
        email: identity.email,
        avatar: identity.picture,
        lastSignInAt: new Date(),
      });

      const sessionToken = await signSessionToken({ unionId });
      setCookie(c, Session.cookieName, sessionToken, {
        ...getSessionCookieOptions(c.req.raw.headers),
        maxAge: Session.maxAgeMs / 1000,
      });
      return c.redirect("/", 302);
    } catch (error) {
      console.error("[google-auth] Callback failed:", error);
      return c.text("Google sign-in failed. Please try again.", 500);
    }
  };
}
