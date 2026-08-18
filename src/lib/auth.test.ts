import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertSameOrigin,
  createSessionToken,
  setGoogleAuthCookie,
  setSessionCookie,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "@/lib/auth";
import { AppError } from "@/lib/errors";

describe("signed sessions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips an allowed identity and rejects tampering and expiry", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    const token = createSessionToken("lisa", now);

    expect(verifySessionToken(token, now)).toEqual({
      slug: "lisa",
      displayName: "Lisa",
    });
    expect(verifySessionToken(`${token.slice(0, -1)}x`, now)).toBeNull();
    expect(
      verifySessionToken(token, now + SESSION_MAX_AGE_SECONDS * 1000 + 1),
    ).toBeNull();
  });

  it("keeps the production session Strict while the callback-only transient cookie is Lax", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "SESSION_SECRET",
      "production-test-secret-at-least-32-characters",
    );
    const response = NextResponse.json({ ok: true });

    setSessionCookie(response, "edward");
    setGoogleAuthCookie(response, "transaction-id");

    const setCookies = response.headers
      .getSetCookie()
      .map((cookie) => cookie.toLowerCase());
    expect(
      setCookies.some(
        (cookie) =>
          cookie.startsWith("atlas_session=") &&
          cookie.includes("secure") &&
          cookie.includes("httponly") &&
          cookie.includes("samesite=strict") &&
          cookie.includes("path=/"),
      ),
    ).toBe(true);
    expect(
      setCookies.some(
        (cookie) =>
          cookie.startsWith("atlas_google_login=") &&
          cookie.includes("secure") &&
          cookie.includes("httponly") &&
          cookie.includes("samesite=lax") &&
          cookie.includes("path=/api/auth/google/callback"),
      ),
    ).toBe(true);
  });
});

describe("same-origin mutation protection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the request host and rejects an unrelated origin", () => {
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/behaviors", {
          headers: { host: "localhost:3000", origin: "http://localhost:3000" },
        }),
      ),
    ).not.toThrow();

    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/behaviors", {
          headers: { host: "localhost:3000", origin: "https://example.test" },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        status: 403,
        code: "INVALID_ORIGIN",
      }),
    );
  });

  it.each([undefined, "null"])(
    "rejects an absent or opaque Origin value of %s",
    (origin) => {
      const headers = origin ? { origin } : undefined;
      expect(() =>
        assertSameOrigin(
          new Request("https://atlas.example.test/api/auth/google/start", {
            method: "POST",
            headers,
          }),
        ),
      ).toThrowError(
        expect.objectContaining<Partial<AppError>>({
          status: 403,
          code: "INVALID_ORIGIN",
        }),
      );
    },
  );

  it("uses the fixed public origin behind a proxy and ignores spoofed forwarded headers", () => {
    vi.stubEnv("APP_ORIGIN", "https://atlas.example.test");

    expect(() =>
      assertSameOrigin(
        new Request("http://atlas-container:3000/api/behaviors", {
          method: "POST",
          headers: { origin: "https://atlas.example.test" },
        }),
      ),
    ).not.toThrow();

    expect(() =>
      assertSameOrigin(
        new Request("http://atlas-container:3000/api/behaviors", {
          method: "POST",
          headers: {
            origin: "https://attacker.example",
            "x-forwarded-host": "attacker.example",
            "x-forwarded-proto": "https",
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        status: 403,
        code: "INVALID_ORIGIN",
      }),
    );
  });
});
