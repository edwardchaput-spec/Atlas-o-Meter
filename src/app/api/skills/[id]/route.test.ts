import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
const dbMocks = vi.hoisted(() => ({
  softDeleteSkill: vi.fn(),
  updateSkill: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireUser: authMocks.requireUser,
}));
vi.mock("@/lib/db", () => dbMocks);

import { DELETE, PATCH } from "@/app/api/skills/[id]/route";
import { AppError } from "@/lib/errors";

const skillId = "342908fd-5477-4a0e-bf98-957b778b8911";
const stars = {
  balance: 1,
  happyCount: 5,
  trickyCount: 0,
  completedSkillCount: 1,
  effectiveHappyCount: 10,
  automaticEarned: 1,
  adjustmentTotal: 0,
  progress: 0,
  target: 10 as const,
};
const skill = {
  id: skillId,
  name: "Tying his shoelaces",
  createdBy: "edward" as const,
  createdAt: "2026-08-16T09:00:00.000Z",
  completedBy: "lisa" as const,
  completedAt: "2026-08-16T10:00:00.000Z",
  updatedBy: "lisa" as const,
  updatedAt: "2026-08-16T10:00:00.000Z",
  version: 3,
};

function mutationRequest(
  method: "PATCH" | "DELETE",
  body: unknown,
  origin = "https://atlas.example.test",
) {
  return new Request(`https://atlas.example.test/api/skills/${skillId}`, {
    method,
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function context(id = skillId) {
  return { params: Promise.resolve({ id }) };
}

describe("individual skill route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMocks.requireUser.mockResolvedValue({
      slug: "lisa",
      displayName: "Lisa",
    });
    dbMocks.updateSkill.mockReturnValue({ skill, stars });
    dbMocks.softDeleteSkill.mockReturnValue({ stars });
  });

  it("renames and completes with the authenticated actor and expected version", async () => {
    const response = await PATCH(
      mutationRequest("PATCH", {
        name: "  Ｔｙｉｎｇ   his shoelaces ",
        completed: true,
        version: 2,
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(dbMocks.updateSkill).toHaveBeenCalledWith(
      skillId,
      { name: "Tying his shoelaces", completed: true, version: 2 },
      "lisa",
    );
    await expect(response.json()).resolves.toEqual({ skill, stars });
  });

  it("soft-deletes as Edward with the expected version", async () => {
    authMocks.requireUser.mockResolvedValue({
      slug: "edward",
      displayName: "Edward",
    });
    const response = await DELETE(
      mutationRequest("DELETE", { version: 3 }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(dbMocks.softDeleteSkill).toHaveBeenCalledWith(skillId, 3, "edward");
    await expect(response.json()).resolves.toEqual({ stars });
  });

  it("rejects cross-origin, invalid ids, empty updates, and unknown fields", async () => {
    expect(
      (
        await PATCH(
          mutationRequest(
            "PATCH",
            { completed: true, version: 1 },
            "https://attacker.example",
          ),
          context(),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await PATCH(
          mutationRequest("PATCH", { completed: true, version: 1 }),
          context("not-a-uuid"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await PATCH(mutationRequest("PATCH", { version: 1 }), context())).status,
    ).toBe(400);
    expect(
      (
        await DELETE(
          mutationRequest("DELETE", { version: 1, force: true }),
          context(),
        )
      ).status,
    ).toBe(400);
    expect(dbMocks.updateSkill).not.toHaveBeenCalled();
    expect(dbMocks.softDeleteSkill).not.toHaveBeenCalled();
  });

  it("maps authentication and stale repository failures without changing actor", async () => {
    authMocks.requireUser.mockRejectedValueOnce(
      new AppError(401, "UNAUTHENTICATED", "Sign in to continue."),
    );
    expect(
      (
        await PATCH(
          mutationRequest("PATCH", { completed: true, version: 1 }),
          context(),
        )
      ).status,
    ).toBe(401);

    dbMocks.updateSkill.mockImplementationOnce(() => {
      throw new AppError(
        409,
        "STALE_SKILL",
        "This skill changed on another phone.",
      );
    });
    const stale = await PATCH(
      mutationRequest("PATCH", { completed: false, version: 1 }),
      context(),
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "STALE_SKILL" },
    });
  });
});
