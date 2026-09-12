export const Session = {
  cookieName: "remiku_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const GoogleOAuth = {
  stateCookieName: "remiku_google_oauth",
  stateMaxAgeMs: 10 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
  googleAuthStart: "/api/auth/google",
  googleOAuthCallback: "/api/auth/google/callback",
} as const;
