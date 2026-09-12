import * as cookie from "cookie";
import * as jose from "jose";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { env } from "../lib/env";
import { findUserByUnionId } from "../queries/users";

const JWT_ALG = "HS256";

export type SessionPayload = {
  unionId: string;
};

export async function signSessionToken(
  payload: SessionPayload,
): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("1 year")
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    if (typeof payload.unionId !== "string" || !payload.unionId) return null;
    return { unionId: payload.unionId };
  } catch {
    return null;
  }
}

export async function authenticateRequest(headers: Headers) {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  const claim = token ? await verifySessionToken(token) : null;
  if (!claim) throw Errors.forbidden("Invalid authentication token.");

  const user = await findUserByUnionId(claim.unionId);
  if (!user) throw Errors.forbidden("User not found. Please re-login.");
  return user;
}
