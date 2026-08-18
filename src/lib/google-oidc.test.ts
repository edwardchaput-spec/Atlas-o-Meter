import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oidcMocks = vi.hoisted(() => ({
  authorizationCodeGrant: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  calculatePKCECodeChallenge: vi.fn(),
  discovery: vi.fn(),
  enableNonRepudiationChecks: vi.fn(),
  randomNonce: vi.fn(),
  randomPKCECodeVerifier: vi.fn(),
  randomState: vi.fn(),
}));

vi.mock("openid-client", () => oidcMocks);

import type { GoogleAuthChallenge } from "@/lib/auth-db";
import { AppError } from "@/lib/errors";
import {
  atlasLoginUrl,
  completeGoogleAuthentication,
  createGoogleAuthorizationRequest,
  googleCompletionUrl,
  googleRedirectUri,
  mapGoogleIdentityToAtlasUser,
  publicGoogleCallbackUrl,
} from "@/lib/google-oidc";

const EDWARD_EMAIL = "edward@example.test";
const LISA_EMAIL = "lisa@example.test";
const STATE = "s".repeat(43);
const NONCE = "n".repeat(43);
const CODE_VERIFIER = "v".repeat(64);

let configurationSequence = 0;

function configureEnvironment(): void {
  configurationSequence += 1;
  vi.stubEnv("APP_ORIGIN", "https://atlas.example.test");
  vi.stubEnv("ATLAS_EDWARD_EMAIL", EDWARD_EMAIL);
  vi.stubEnv("GOOGLE_CLIENT_ID", `test-client-${configurationSequence}`);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret-not-real");
}

function fakeAuthorizationUrl(
  _configuration: unknown,
  parameters: Record<string, string>,
): URL {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function challenge(userSlug: "edward" | "lisa" = "edward") {
  return {
    id: "transaction-id",
    userSlug,
    state: STATE,
    nonce: NONCE,
    codeVerifier: CODE_VERIFIER,
    expiresAt: Date.UTC(2026, 7, 9, 10, 10),
  } satisfies GoogleAuthChallenge;
}

describe("Google OIDC authorization request", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    configureEnvironment();
    oidcMocks.discovery.mockResolvedValue({ timeout: 0 });
    oidcMocks.randomState.mockReturnValue(STATE);
    oidcMocks.randomNonce.mockReturnValue(NONCE);
    oidcMocks.randomPKCECodeVerifier.mockReturnValue(CODE_VERIFIER);
    oidcMocks.calculatePKCECodeChallenge.mockResolvedValue("pkce-challenge");
    oidcMocks.buildAuthorizationUrl.mockImplementation(fakeAuthorizationUrl);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the fixed issuer, exact callback, minimum scopes, PKCE, state and nonce", async () => {
    const request = await createGoogleAuthorizationRequest();

    expect(oidcMocks.discovery).toHaveBeenCalledWith(
      new URL("https://accounts.google.com"),
      process.env.GOOGLE_CLIENT_ID,
      "test-secret-not-real",
    );
    expect(oidcMocks.enableNonRepudiationChecks).toHaveBeenCalledTimes(1);
    expect(oidcMocks.enableNonRepudiationChecks).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 10 }),
    );
    expect(oidcMocks.calculatePKCECodeChallenge).toHaveBeenCalledWith(
      CODE_VERIFIER,
    );
    expect(request).toMatchObject({
      state: STATE,
      nonce: NONCE,
      codeVerifier: CODE_VERIFIER,
    });

    const authorizationUrl = new URL(request.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://atlas.example.test/api/auth/google/callback",
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("scope")).toBe("openid email");
    expect(authorizationUrl.searchParams.get("state")).toBe(STATE);
    expect(authorizationUrl.searchParams.get("nonce")).toBe(NONCE);
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(
      "pkce-challenge",
    );
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorizationUrl.searchParams.get("prompt")).toBe("select_account");
    expect(authorizationUrl.searchParams.get("client_secret")).toBeNull();
    expect(authorizationUrl.searchParams.get("login_hint")).toBeNull();
    expect(authorizationUrl.searchParams.get("access_type")).toBeNull();
    expect(request.authorizationUrl).not.toContain(EDWARD_EMAIL);
    expect(request.authorizationUrl).not.toContain(LISA_EMAIL);
    expect(request.authorizationUrl).not.toContain("gmail");
  });

  it("maps discovery failure to a stable unavailable response", async () => {
    oidcMocks.discovery.mockRejectedValueOnce(
      new Error("simulated discovery failure"),
    );

    await expect(createGoogleAuthorizationRequest()).rejects.toMatchObject({
      status: 503,
      code: "GOOGLE_UNAVAILABLE",
    });
  });
});

describe("Google identity policy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    configureEnvironment();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps only the verified configured Edward account", () => {
    expect(
      mapGoogleIdentityToAtlasUser("edward", {
        sub: "google-subject-edward",
        email: EDWARD_EMAIL,
        email_verified: true,
      }),
    ).toEqual({ slug: "edward", displayName: "Edward" });
  });

  it("rejects an unknown Google account", () => {
    expect(() =>
      mapGoogleIdentityToAtlasUser("edward", {
        sub: "unknown-subject",
        email: "someone-else@example.test",
        email_verified: true,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        status: 403,
        code: "GOOGLE_ACCOUNT_UNAUTHORISED",
      }),
    );
  });

  it.each([false, undefined, "true"])(
    "rejects an email_verified value of %s",
    (emailVerified) => {
      expect(() =>
        mapGoogleIdentityToAtlasUser("edward", {
          sub: "edward-subject",
          email: EDWARD_EMAIL,
          email_verified: emailVerified,
        }),
      ).toThrowError(
        expect.objectContaining<Partial<AppError>>({
          code: "GOOGLE_ACCOUNT_UNAUTHORISED",
        }),
      );
    },
  );

  it.each([
    {
      description: "missing subject",
      claims: { email: EDWARD_EMAIL, email_verified: true },
    },
    {
      description: "missing email",
      claims: { sub: "edward-subject", email_verified: true },
    },
  ])("rejects verified claims with $description", ({ claims }) => {
    expect(() => mapGoogleIdentityToAtlasUser("edward", claims)).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        status: 401,
        code: "GOOGLE_ACCOUNT_UNAUTHORISED",
      }),
    );
  });

  it("rejects the Lisa profile even if a legacy challenge reaches the callback", () => {
    expect(() =>
      mapGoogleIdentityToAtlasUser("lisa", {
        sub: "legacy-lisa-challenge",
        email: EDWARD_EMAIL,
        email_verified: true,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        status: 403,
        code: "GOOGLE_PROFILE_MISMATCH",
      }),
    );
  });
});

describe("Google callback verification boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    configureEnvironment();
    oidcMocks.discovery.mockResolvedValue({ timeout: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the stored PKCE verifier, state and nonce to openid-client", async () => {
    oidcMocks.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({
        sub: "edward-subject",
        email: EDWARD_EMAIL,
        email_verified: true,
      }),
    });
    const callback = new URL(
      `https://atlas.example.test/api/auth/google/callback?code=provider-code&state=${STATE}`,
    );

    await expect(
      completeGoogleAuthentication(callback, challenge()),
    ).resolves.toEqual({ slug: "edward", displayName: "Edward" });
    expect(oidcMocks.authorizationCodeGrant).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 10 }),
      callback,
      {
        pkceCodeVerifier: CODE_VERIFIER,
        expectedState: STATE,
        expectedNonce: NONCE,
        idTokenExpected: true,
      },
    );
  });

  it.each([
    "invalid signature",
    "wrong audience",
    "expired token",
    "nonce mismatch",
  ])("rejects a provider boundary failure: %s", async (reason) => {
    oidcMocks.authorizationCodeGrant.mockRejectedValue(new Error(reason));
    const callback = new URL(
      `https://atlas.example.test/api/auth/google/callback?code=provider-code&state=${STATE}`,
    );

    await expect(
      completeGoogleAuthentication(callback, challenge()),
    ).rejects.toMatchObject({
      status: 401,
      code: "GOOGLE_VERIFICATION_FAILED",
      message: "Google sign-in could not be verified. Please try again.",
    });
  });

  it("supports a fully injected verifier without network access", async () => {
    const verifier = vi.fn().mockResolvedValue({
      sub: "edward-subject",
      email: EDWARD_EMAIL,
      email_verified: true,
    });
    const callback = new URL(
      `https://atlas.example.test/api/auth/google/callback?code=test&state=${STATE}`,
    );

    await expect(
      completeGoogleAuthentication(callback, challenge("edward"), verifier),
    ).resolves.toEqual({ slug: "edward", displayName: "Edward" });
    expect(verifier).toHaveBeenCalledWith(callback, challenge("edward"));
    expect(oidcMocks.authorizationCodeGrant).not.toHaveBeenCalled();
  });
});

describe("fixed Atlas Google URLs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    configureEnvironment();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reconstructs the callback on APP_ORIGIN and never accepts an arbitrary redirect", () => {
    expect(googleRedirectUri()).toBe(
      "https://atlas.example.test/api/auth/google/callback",
    );
    expect(
      publicGoogleCallbackUrl(
        `http://internal:3000/api/auth/google/callback?code=secret-code&state=${STATE}`,
      ).href,
    ).toBe(
      `https://atlas.example.test/api/auth/google/callback?code=secret-code&state=${STATE}`,
    );
    expect(googleCompletionUrl().href).toBe(
      "https://atlas.example.test/auth/google/complete",
    );
    expect(atlasLoginUrl("expired", "lisa").href).toBe(
      "https://atlas.example.test/?authError=expired&profile=lisa",
    );
  });
});
