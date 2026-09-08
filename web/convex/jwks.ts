import { httpAction } from "./_generated/server";

const parseJson = (value: string, name: string) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid JSON value.";
    throw new Error(`${name} is not valid JSON: ${message}`);
  }
};

const buildJwks = () => {
  const jwksRaw = process.env.CUSTOM_AUTH_JWKS;
  if (jwksRaw) {
    return parseJson(jwksRaw, "CUSTOM_AUTH_JWKS");
  }
  const jwkRaw = process.env.CUSTOM_AUTH_PUBLIC_JWK;
  if (jwkRaw) {
    return { keys: [parseJson(jwkRaw, "CUSTOM_AUTH_PUBLIC_JWK")] };
  }
  throw new Error("CUSTOM_AUTH_JWKS or CUSTOM_AUTH_PUBLIC_JWK is not set.");
};

export const jwks = httpAction(async () => {
  const body = JSON.stringify(buildJwks());
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
    },
  });
});
