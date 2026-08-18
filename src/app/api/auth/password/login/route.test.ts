import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const passwordMocks = vi.hoisted(() => ({
  authenticateLisaPassword: vi.fn(),
}));

vi.mock("@/lib/password-auth", () => passwordMocks);

import { POST } from "@/app/api/auth/password/login/route";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { AppError } from "@/lib/errors";

function loginRequest(body: unknown, origin = "https://atlas.example.test") {
  return new Request("https://atlas.example.test/api/auth/password/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("Lisa password login route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-characters");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies Lisa and creates the existing protected session", async () => {
    const response = await POST(
      loginRequest({ username: "lisa", password: " exact password " }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      user: { slug: "lisa", displayName: "Lisa" },
    });
    expect(passwordMocks.authenticateLisaPassword).toHaveBeenCalledWith(
      " exact password ",
    );
    expect(
      verifySessionToken(response.cookies.get(SESSION_COOKIE)?.value),
    ).toEqual({ slug: "lisa", displayName: "Lisa" });
  });

  it("rejects another actor and cross-origin login before password verification", async () => {
    const wrongActor = await POST(
      loginRequest({ username: "edward", password: "bounded password" }),
    );
    expect(wrongActor.status).toBe(400);

    const wrongOrigin = await POST(
      loginRequest(
        { username: "lisa", password: "bounded password" },
        "https://attacker.example",
      ),
    );
    expect(wrongOrigin.status).toBe(403);
    expect(passwordMocks.authenticateLisaPassword).not.toHaveBeenCalled();
  });

  it("returns the safe authentication failure without creating a session", async () => {
    passwordMocks.authenticateLisaPassword.mockRejectedValue(
      new AppError(
        401,
        "INVALID_CREDENTIALS",
        "That password could not be verified.",
      ),
    );
    const response = await POST(
      loginRequest({ username: "lisa", password: "wrong password" }),
    );

    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "That password could not be verified.",
      },
    });
  });
});
