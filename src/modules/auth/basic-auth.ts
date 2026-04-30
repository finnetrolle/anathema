const AUTH_USER = process.env.APP_BASIC_AUTH_USER ?? "";
const AUTH_PASS = process.env.APP_BASIC_AUTH_PASSWORD ?? "";

export function isBasicAuthConfigured(): boolean {
  return AUTH_USER.length > 0 && AUTH_PASS.length > 0;
}

export function checkBasicAuth(request: Request): boolean {
  if (!isBasicAuthConfigured()) {
    return true;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return false;
  }

  const encoded = authHeader.slice("Basic ".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf-8");
  const colonIndex = decoded.indexOf(":");

  if (colonIndex === -1) {
    return false;
  }

  const user = decoded.slice(0, colonIndex);
  const pass = decoded.slice(colonIndex + 1);

  return user === AUTH_USER && pass === AUTH_PASS;
}

export function basicAuthChallenge(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Anathema", charset="UTF-8"',
    },
  });
}
