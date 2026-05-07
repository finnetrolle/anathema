function getAuthCredentials() {
  return {
    user: process.env.APP_BASIC_AUTH_USER ?? "",
    pass: process.env.APP_BASIC_AUTH_PASSWORD ?? "",
  };
}

export function isBasicAuthConfigured(): boolean {
  const { user, pass } = getAuthCredentials();
  return user.length > 0 && pass.length > 0;
}

function safeEqual(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a);
  const bytesB = new TextEncoder().encode(b);
  const length = Math.max(bytesA.length, bytesB.length);
  let mismatch = bytesA.length ^ bytesB.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (bytesA[index] ?? 0) ^ (bytesB[index] ?? 0);
  }

  return mismatch === 0;
}

function decodeBase64(value: string): string | null {
  try {
    return atob(value);
  } catch {
    return null;
  }
}

export function checkBasicAuth(request: Request): boolean {
  if (!isBasicAuthConfigured()) {
    return true;
  }

  const { user: AUTH_USER, pass: AUTH_PASS } = getAuthCredentials();

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return false;
  }

  const encoded = authHeader.slice("Basic ".length);
  const decoded = decodeBase64(encoded);

  if (decoded === null) {
    return false;
  }

  const colonIndex = decoded.indexOf(":");

  if (colonIndex === -1) {
    return false;
  }

  const user = decoded.slice(0, colonIndex);
  const pass = decoded.slice(colonIndex + 1);

  return safeEqual(user, AUTH_USER) && safeEqual(pass, AUTH_PASS);
}

export function basicAuthChallenge(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Anathema", charset="UTF-8"',
    },
  });
}
