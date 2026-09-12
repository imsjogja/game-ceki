import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  appOrigin: process.env.APP_ORIGIN?.replace(/\/+$/, "") ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  ownerGoogleSub: process.env.OWNER_GOOGLE_SUB ?? "",
  // TURN memakai TURN REST credential: secret ini hanya berada di server.
  voiceStunUrls:
    process.env.VOICE_STUN_URLS ??
    "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302",
  voiceTurnUrls: process.env.VOICE_TURN_URLS ?? "",
  voiceTurnSecret: process.env.VOICE_TURN_SECRET ?? "",
  voiceTurnTtlSeconds: Math.max(
    60,
    Math.min(
      3600,
      Number.parseInt(process.env.VOICE_TURN_TTL_SECONDS ?? "600", 10) || 600
    )
  ),
};
