import { NextRequest, NextResponse } from "next/server";

import {
  basicAuthChallenge,
  checkBasicAuth,
  isBasicAuthConfigured,
} from "@/modules/auth/basic-auth";

const PUBLIC_PATHS = ["/_next", "/favicon.ico", "/api/health"];

function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
  ].join("; ");
}

const NONCE_HEADER = "x-csp-nonce";

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (publicPath) =>
      pathname === publicPath || pathname.startsWith(publicPath + "/"),
  );
}

function withSecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(NONCE_HEADER, nonce);
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = createNonce();

  if (isPublicPath(pathname)) {
    return withSecurityHeaders(NextResponse.next(), nonce);
  }

  if (isBasicAuthConfigured() && !checkBasicAuth(request)) {
    return basicAuthChallenge();
  }

  return withSecurityHeaders(NextResponse.next(), nonce);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
