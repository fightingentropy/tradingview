import type { AuthConfig } from "convex/server";

const issuer = process.env.CUSTOM_AUTH_ISSUER;
const jwks = process.env.CUSTOM_AUTH_JWKS_URL;
const audience = process.env.CUSTOM_AUTH_AUDIENCE;

if (!issuer || !jwks) {
  console.warn(
    "CUSTOM_AUTH_ISSUER and CUSTOM_AUTH_JWKS_URL are not set; auth providers are disabled.",
  );
}

export default {
  providers:
    issuer && jwks
      ? [
          {
            type: "customJwt",
            issuer,
            jwks,
            algorithm: "RS256",
            ...(audience ? { applicationID: audience } : {}),
          },
        ]
      : [],
} satisfies AuthConfig;
