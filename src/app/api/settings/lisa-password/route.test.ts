import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireEdward: vi.fn(),
}));
const authDbMocks = vi.hoisted(() => ({
  getLisaPasswordStatus: vi.fn(),
}));
const passwordMocks = vi.hoisted(() => ({
  replaceLisaPassword: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireEdward: authMocks.requireEdward,
}));
vi.mock("@/lib/auth-db", () => authDbMocks);
vi.mock("@/lib/password-auth", () => passwordMocks);

import { GET, PUT } from "@/app/api/settings/lisa-password/route";
import { AppError } from "@/lib/errors";

function updateRequest(
  password: string,
  origin = "https://atlas.example.test",
) {
  return new Request("https://atlas.example.test/api/settings/lisa-password", {
    method: "PUT",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({ password }),
  });
}

describe("Lisa password settings route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMocks.requireEdward.mockResolvedValue({
      slug: "edward",
      displayName: "Edward",
    });
    authDbMocks.getLisaPasswordStatus.mockReturnValue({
      configured: false,
      updatedAt: null,
    });
    passwordMocks.replaceLisaPassword.mockResolvedValue({
      configured: true,
      updatedAt: "2026-08-10T10:00:00.000Z",
    });
  });

  it("returns only credential status to Edward", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      configured: false,
      updatedAt: null,
    });
    expect(authMocks.requireEdward).toHaveBeenCalledOnce();
  });

  it("lets Edward replace the exact validated password", async () => {
    const password = "  family passphrase  ";
    const response = await PUT(updateRequest(password));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      configured: true,
      updatedAt: "2026-08-10T10:00:00.000Z",
    });
    expect(passwordMocks.replaceLisaPassword).toHaveBeenCalledWith(
      password,
      "edward",
    );
  });

  it("enforces Edward authorization, same-origin, and password policy", async () => {
    authMocks.requireEdward.mockRejectedValueOnce(
      new AppError(
        403,
        "EDWARD_REQUIRED",
        "Only Edward can manage Lisa's password.",
      ),
    );
    expect((await GET()).status).toBe(403);

    expect(
      (await PUT(updateRequest("valid passphrase", "https://attacker.example")))
        .status,
    ).toBe(403);

    expect((await PUT(updateRequest("short"))).status).toBe(400);
    expect(passwordMocks.replaceLisaPassword).not.toHaveBeenCalled();
  });
});
