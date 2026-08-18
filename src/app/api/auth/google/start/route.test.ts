import { beforeEach, describe, expect, it, vi } from "vitest";

const authDbMocks = vi.hoisted(() => ({
  assertGoogleStartAllowed: vi.fn(),
  createGoogleAuthChallenge: vi.fn(),
}));

const googleMocks = vi.hoisted(() => ({
  createGoogleAuthorizationRequest: vi.fn(),
}));

vi.mock("@/lib/auth-db", () => authDbMocks);
vi.mock("@/lib/google-oidc", () => googleMocks);

import { POST } from "@/app/api/auth/google/start/route";
import { GOOGLE_AUTH_COOKIE } from "@/lib/auth";

const AUTHORIZATION = {
  authorizationUrl:
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=test-client",
  state: "s".repeat(43),
  nonce: "n".repeat(43),
  codeVerifier: "v".repeat(64),
};

function startRequest(
  body: unknown,
  origin = "https://atlas.example.test",
): Request {
  return new Request("https://atlas.example.test/api/auth/google/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  });
}

describe("Google start route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    googleMocks.createGoogleAuthorizationRequest.mockResolvedValue(
      AUTHORIZATION,
    );
    authDbMocks.createGoogleAuthChallenge.mockReturnValue({
      id: "transaction-id",
      userSlug: "edward",
      state: AUTHORIZATION.state,
      nonce: AUTHORIZATION.nonce,
      codeVerifier: AUTHORIZATION.codeVerifier,
      expiresAt: Date.UTC(2026, 7, 9, 10, 10),
    });
  });

  it("starts only the selected fixed profile and exposes only the provider URL", async () => {
    const response = await POST(startRequest({ username: " EDWARD " }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: AUTHORIZATION.authorizationUrl,
    });
    expect(authDbMocks.assertGoogleStartAllowed).toHaveBeenCalledWith("edward");
    expect(googleMocks.createGoogleAuthorizationRequest).toHaveBeenCalledWith();
    expect(authDbMocks.createGoogleAuthChallenge).toHaveBeenCalledWith(
      "edward",
      AUTHORIZATION,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");

    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${GOOGLE_AUTH_COOKIE}=`))
      ?.toLowerCase();
    expect(cookie).toContain("transaction-id");
    expect(cookie).toContain("httponly");
    expect(cookie).toContain("samesite=lax");
    expect(cookie).toContain("max-age=600");
    expect(cookie).toContain("path=/api/auth/google/callback");
  });

  it("rejects Lisa, unknown actors, and extra client trust claims", async () => {
    const lisa = await POST(startRequest({ username: "lisa" }));
    expect(lisa.status).toBe(400);

    const unknown = await POST(startRequest({ username: "atlas" }));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });

    const extra = await POST(
      startRequest({ username: "edward", email: "edward@example.test" }),
    );
    expect(extra.status).toBe(400);
    expect(googleMocks.createGoogleAuthorizationRequest).not.toHaveBeenCalled();
  });

  it("retains same-origin protection on the login mutation", async () => {
    const response = await POST(
      startRequest({ username: "edward" }, "https://attacker.example"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_ORIGIN",
        message: "This request did not come from Atlas-o-meter.",
      },
    });
    expect(authDbMocks.assertGoogleStartAllowed).not.toHaveBeenCalled();
    expect(googleMocks.createGoogleAuthorizationRequest).not.toHaveBeenCalled();
  });
});
