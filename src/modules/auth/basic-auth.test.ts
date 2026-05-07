import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const AUTH_USER = "admin";
const AUTH_PASS = "secret";

vi.stubEnv("APP_BASIC_AUTH_USER", AUTH_USER);
vi.stubEnv("APP_BASIC_AUTH_PASSWORD", AUTH_PASS);

import {
  checkBasicAuth,
  isBasicAuthConfigured,
  basicAuthChallenge,
} from "./basic-auth";

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set("authorization", authHeader);
  }
  return new Request("http://localhost", { headers });
}

function encodeBasic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

describe("basic-auth", () => {
  describe("isBasicAuthConfigured", () => {
    it("returns true when both env vars are set", () => {
      expect(isBasicAuthConfigured()).toBe(true);
    });
  });

  describe("checkBasicAuth", () => {
    it("rejects request without authorization header", () => {
      expect(checkBasicAuth(makeRequest())).toBe(false);
    });

    it("rejects request with wrong credentials", () => {
      expect(checkBasicAuth(makeRequest(encodeBasic("admin", "wrong")))).toBe(
        false,
      );
    });

    it("accepts request with correct credentials", () => {
      expect(checkBasicAuth(makeRequest(encodeBasic("admin", "secret")))).toBe(
        true,
      );
    });

    it("rejects request with wrong username", () => {
      expect(checkBasicAuth(makeRequest(encodeBasic("wrong", "secret")))).toBe(
        false,
      );
    });

    it("rejects malformed basic auth (no colon)", () => {
      const encoded = `Basic ${Buffer.from("nocolon").toString("base64")}`;
      expect(checkBasicAuth(makeRequest(encoded))).toBe(false);
    });
  });

  describe("basicAuthChallenge", () => {
    it("returns 401 with WWW-Authenticate header", () => {
      const res = basicAuthChallenge();
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain(
        'Basic realm="Anathema"',
      );
    });
  });
});
