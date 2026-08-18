import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextHeadersMocks = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

const authDbMocks = vi.hoisted(() => ({
  createWebAuthnChallenge: vi.fn(),
}));

const webAuthnMocks = vi.hoisted(() => ({
  createRegistrationOptions: vi.fn(),
}));

vi.mock("next/headers", () => nextHeadersMocks);
vi.mock("@/lib/auth-db", () => authDbMocks);
vi.mock("@/lib/webauthn", () => webAuthnMocks);

import { POST } from "@/app/api/auth/passkeys/register/options/route";
import {
  createSessionToken,
  SESSION_COOKIE,
  WEBAUTHN_CHALLENGE_COOKIE,
} from "@/lib/auth";

describe("passkey registration after identity verification", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-characters");
    const sessionToken = createSessionToken("edward");
    nextHeadersMocks.cookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === SESSION_COOKIE
          ? { name: SESSION_COOKIE, value: sessionToken }
          : undefined,
      ),
    });
    webAuthnMocks.createRegistrationOptions.mockResolvedValue({
      challenge: "registration-challenge",
      rp: { id: "atlas.example.test", name: "Atlas-o-meter" },
    });
    authDbMocks.createWebAuthnChallenge.mockReturnValue(
      "webauthn-transaction-id",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the existing signed session and starts registration for its mapped actor", async () => {
    const response = await POST(
      new Request(
        "https://atlas.example.test/api/auth/passkeys/register/options",
        {
          method: "POST",
          headers: { origin: "https://atlas.example.test" },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(webAuthnMocks.createRegistrationOptions).toHaveBeenCalledWith(
      "edward",
    );
    expect(authDbMocks.createWebAuthnChallenge).toHaveBeenCalledWith(
      "edward",
      "registration",
      "registration-challenge",
    );
    expect(response.cookies.get(WEBAUTHN_CHALLENGE_COOKIE)?.value).toBe(
      "webauthn-transaction-id",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
