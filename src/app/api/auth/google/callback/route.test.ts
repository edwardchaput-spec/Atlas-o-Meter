import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextHeadersMocks = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

const authDbMocks = vi.hoisted(() => ({
  assertGoogleCallbackAllowed: vi.fn(),
  consumeGoogleAuthChallenge: vi.fn(),
}));

const googleMocks = vi.hoisted(() => ({
  atlasLoginUrl: vi.fn(),
  completeGoogleAuthentication: vi.fn(),
  googleCompletionUrl: vi.fn(),
  publicGoogleCallbackUrl: vi.fn(),
}));

vi.mock("next/headers", () => nextHeadersMocks);
vi.mock("@/lib/auth-db", () => authDbMocks);
vi.mock("@/lib/google-oidc", () => googleMocks);

import { GET } from "@/app/api/auth/google/callback/route";
import {
  GOOGLE_AUTH_COOKIE,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth";
import { AppError } from "@/lib/errors";

const STATE = "s".repeat(43);
const CHALLENGE = {
  id: "google-transaction-id",
  userSlug: "edward" as const,
  state: STATE,
  nonce: "n".repeat(43),
  codeVerifier: "v".repeat(64),
  expiresAt: Date.UTC(2026, 7, 9, 10, 10),
};

function callbackRequest(query: string): Request {
  return new Request(
    `http://atlas-container:3000/api/auth/google/callback?${query}`,
  );
}

describe("Google callback route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-characters");
    nextHeadersMocks.cookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === GOOGLE_AUTH_COOKIE ? { name, value: CHALLENGE.id } : undefined,
      ),
    });
    authDbMocks.consumeGoogleAuthChallenge.mockReturnValue(CHALLENGE);
    googleMocks.publicGoogleCallbackUrl.mockImplementation(
      (requestUrl: string) => {
        const incoming = new URL(requestUrl);
        const callback = new URL(
          "https://atlas.example.test/api/auth/google/callback",
        );
        callback.search = incoming.search;
        return callback;
      },
    );
    googleMocks.googleCompletionUrl.mockReturnValue(
      new URL("https://atlas.example.test/auth/google/complete"),
    );
    googleMocks.atlasLoginUrl.mockImplementation(
      (error?: string, user?: "edward" | "lisa") => {
        const target = new URL("https://atlas.example.test/");
        if (error) target.searchParams.set("authError", error);
        if (user) target.searchParams.set("profile", user);
        return target;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates the existing signed session and clears transient state", async () => {
    googleMocks.completeGoogleAuthentication.mockResolvedValue({
      slug: "edward",
      displayName: "Edward",
    });

    const response = await GET(
      callbackRequest(`code=provider-code&state=${STATE}`),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://atlas.example.test/auth/google/complete",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(authDbMocks.consumeGoogleAuthChallenge).toHaveBeenCalledWith(
      CHALLENGE.id,
      STATE,
    );
    expect(authDbMocks.assertGoogleCallbackAllowed).toHaveBeenCalledWith(
      "edward",
    );
    expect(googleMocks.completeGoogleAuthentication).toHaveBeenCalledWith(
      new URL(
        `https://atlas.example.test/api/auth/google/callback?code=provider-code&state=${STATE}`,
      ),
      CHALLENGE,
    );

    const sessionToken = response.cookies.get(SESSION_COOKIE)?.value;
    expect(verifySessionToken(sessionToken)).toEqual({
      slug: "edward",
      displayName: "Edward",
    });
    expect(response.cookies.get(GOOGLE_AUTH_COOKIE)?.value).toBe("");

    const setCookies = response.headers
      .getSetCookie()
      .map((cookie) => cookie.toLowerCase());
    expect(
      setCookies.some(
        (cookie) =>
          cookie.startsWith(`${SESSION_COOKIE}=`) &&
          cookie.includes("httponly") &&
          cookie.includes("samesite=strict") &&
          cookie.includes("path=/") &&
          cookie.includes("max-age=2592000"),
      ),
    ).toBe(true);
    expect(
      setCookies.some(
        (cookie) =>
          cookie.startsWith(`${GOOGLE_AUTH_COOKIE}=`) &&
          cookie.includes("samesite=lax") &&
          cookie.includes("expires=thu, 01 jan 1970"),
      ),
    ).toBe(true);
  });

  it("rejects a selected-profile mismatch without creating a session", async () => {
    googleMocks.completeGoogleAuthentication.mockRejectedValue(
      new AppError(
        403,
        "GOOGLE_PROFILE_MISMATCH",
        "That Google account isn't authorised for this Atlas profile.",
      ),
    );

    const response = await GET(
      callbackRequest(`code=provider-code&state=${STATE}`),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://atlas.example.test/?authError=not_authorised&profile=edward",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(response.cookies.get(GOOGLE_AUTH_COOKIE)?.value).toBe("");
  });

  it("consumes the transaction but does not exchange a cancelled response", async () => {
    const response = await GET(
      callbackRequest(`error=access_denied&state=${STATE}`),
    );

    expect(authDbMocks.consumeGoogleAuthChallenge).toHaveBeenCalledWith(
      CHALLENGE.id,
      STATE,
    );
    expect(googleMocks.completeGoogleAuthentication).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://atlas.example.test/?authError=cancelled&profile=edward",
    );
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("maps missing or mismatched transaction state to an expired ceremony", async () => {
    authDbMocks.consumeGoogleAuthChallenge.mockImplementation(() => {
      throw new AppError(
        400,
        "GOOGLE_LOGIN_EXPIRED",
        "That Google sign-in expired. Please start again.",
      );
    });

    const response = await GET(callbackRequest(`state=${"x".repeat(43)}`));

    expect(response.headers.get("location")).toBe(
      "https://atlas.example.test/?authError=expired",
    );
    expect(authDbMocks.assertGoogleCallbackAllowed).not.toHaveBeenCalled();
    expect(googleMocks.completeGoogleAuthentication).not.toHaveBeenCalled();
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});
