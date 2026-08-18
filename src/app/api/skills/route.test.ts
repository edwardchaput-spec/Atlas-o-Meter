import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ createSkill: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireUser: authMocks.requireUser,
}));
vi.mock("@/lib/db", () => dbMocks);

import { POST } from "@/app/api/skills/route";
import { AppError } from "@/lib/errors";

const requestId = "2105a5e2-351f-481c-a858-9d3e89248513";
const skill = {
  id: "342908fd-5477-4a0e-bf98-957b778b8911",
  name: "Tying his shoelaces",
  createdBy: "lisa" as const,
  createdAt: "2026-08-16T09:00:00.000Z",
  completedBy: null,
  completedAt: null,
  updatedBy: "lisa" as const,
  updatedAt: "2026-08-16T09:00:00.000Z",
  version: 1,
};
const stars = {
  balance: 0,
  happyCount: 0,
  trickyCount: 0,
  completedSkillCount: 0,
  effectiveHappyCount: 0,
  automaticEarned: 0,
  adjustmentTotal: 0,
  progress: 0,
  target: 10 as const,
};

function createRequest(body: unknown, origin = "https://atlas.example.test") {
  return new Request("https://atlas.example.test/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("skills collection route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMocks.requireUser.mockResolvedValue({
      slug: "lisa",
      displayName: "Lisa",
    });
    dbMocks.createSkill.mockReturnValue({ skill, stars, created: true });
  });

  it("creates a cleaned skill as the authenticated actor", async () => {
    const response = await POST(
      createRequest({
        name: "  Ｔｙｉｎｇ   his shoelaces ",
        clientRequestId: requestId,
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      skill,
      stars,
      created: true,
    });
    expect(dbMocks.createSkill).toHaveBeenCalledWith(
      { name: "Tying his shoelaces", clientRequestId: requestId },
      "lisa",
    );
  });

  it("returns 200 when an idempotent or canonical create already exists", async () => {
    authMocks.requireUser.mockResolvedValue({
      slug: "edward",
      displayName: "Edward",
    });
    dbMocks.createSkill.mockReturnValue({ skill, stars, created: false });

    const response = await POST(
      createRequest({ name: skill.name, clientRequestId: requestId }),
    );

    expect(response.status).toBe(200);
    expect(dbMocks.createSkill).toHaveBeenCalledWith(
      { name: skill.name, clientRequestId: requestId },
      "edward",
    );
    await expect(response.json()).resolves.toMatchObject({ created: false });
  });

  it("enforces same-origin authentication and strict input validation", async () => {
    expect(
      (
        await POST(
          createRequest(
            { name: skill.name, clientRequestId: requestId },
            "https://attacker.example",
          ),
        )
      ).status,
    ).toBe(403);

    authMocks.requireUser.mockRejectedValueOnce(
      new AppError(401, "UNAUTHENTICATED", "Sign in to continue."),
    );
    expect(
      (
        await POST(
          createRequest({ name: skill.name, clientRequestId: requestId }),
        )
      ).status,
    ).toBe(401);

    expect(
      (await POST(createRequest({ name: "x", clientRequestId: requestId })))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(
          createRequest({
            name: "x".repeat(3_000),
            clientRequestId: requestId,
          }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await POST(
          createRequest({
            name: skill.name,
            clientRequestId: requestId,
            createdBy: "edward",
          }),
        )
      ).status,
    ).toBe(400);
    expect(dbMocks.createSkill).not.toHaveBeenCalled();
  });
});
