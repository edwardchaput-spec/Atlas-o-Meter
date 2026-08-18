import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createBehavior,
  createDatabase,
  createSkill,
  createStarAdjustment,
  deleteBehavior,
  getHistory,
  softDeleteSkill,
  updateSkill,
} from "@/lib/db";
import type { SkillEntry, UserSlug } from "@/lib/types";

describe("history SQLite repository", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function addBehavior(
    mood: "happy" | "sad",
    occurredAt: string,
    actor: UserSlug = "edward",
  ) {
    return createBehavior(
      {
        mood,
        occurredAt,
        tag: null,
        clientRequestId: randomUUID(),
      },
      actor,
      db,
      "2026-10-01T09:00:00.000Z",
    ).behavior;
  }

  function addSkill(
    name: string,
    createdAt: string,
    actor: UserSlug = "edward",
  ): SkillEntry {
    return createSkill(
      { name, clientRequestId: randomUUID() },
      actor,
      db,
      createdAt,
    ).skill;
  }

  function completeSkill(
    skill: SkillEntry,
    completedAt: string,
    actor: UserSlug = "lisa",
  ): SkillEntry {
    return updateSkill(
      skill.id,
      { completed: true, version: skill.version },
      actor,
      db,
      completedAt,
    ).skill;
  }

  function addCorrection(delta: number, createdAt: string): void {
    createStarAdjustment(
      {
        delta,
        kind: "correction",
        reason: "History repository test",
        clientRequestId: randomUUID(),
      },
      "edward",
      db,
      createdAt,
    );
  }

  it("uses half-open progress ranges and reconstructs the ordered opening state", () => {
    const from = "2026-08-01T00:00:00.000Z";
    const to = "2026-09-01T00:00:00.000Z";

    // This tricky moment happens at zero and must not create debt.
    addBehavior("sad", "2026-07-01T12:00:00.000Z", "lisa");
    for (let index = 0; index < 5; index += 1) {
      addBehavior(
        "happy",
        `2026-07-${String(10 + index).padStart(2, "0")}T12:00:00.000Z`,
      );
    }
    const before = addSkill("Tying his shoelaces", "2026-07-15T12:00:00.000Z");
    completeSkill(before, "2026-07-20T12:00:00.000Z");

    const deletedBefore = addBehavior(
      "happy",
      "2026-07-31T23:59:59.999Z",
      "lisa",
    );
    deleteBehavior(
      deletedBefore.id,
      deletedBefore.version,
      "edward",
      db,
      "2026-08-02T00:00:00.000Z",
    );

    const reopenedBase = addSkill(
      "Fastening his coat",
      "2026-07-21T09:00:00.000Z",
    );
    const reopenedCompleted = completeSkill(
      reopenedBase,
      "2026-07-22T09:00:00.000Z",
    );
    updateSkill(
      reopenedCompleted.id,
      { completed: false, version: reopenedCompleted.version },
      "edward",
      db,
      "2026-07-23T09:00:00.000Z",
    );

    addBehavior("sad", from, "lisa");
    const atStart = addSkill(
      "Making his breakfast",
      "2026-07-31T12:00:00.000Z",
    );
    completeSkill(atStart, from);
    addBehavior("happy", "2026-08-15T12:00:00.000Z");

    const deletedWithinBase = addSkill(
      "Packing his bag",
      "2026-08-10T08:00:00.000Z",
    );
    const deletedWithin = completeSkill(
      deletedWithinBase,
      "2026-08-10T09:00:00.000Z",
    );
    softDeleteSkill(
      deletedWithin.id,
      deletedWithin.version,
      "lisa",
      db,
      "2026-08-11T09:00:00.000Z",
    );

    const atEnd = addSkill("Reading a whole book", "2026-08-31T12:00:00.000Z");
    completeSkill(atEnd, to);
    addBehavior("happy", to);

    addCorrection(2, "2026-07-31T23:59:59.999Z");
    createStarAdjustment(
      {
        delta: -1,
        kind: "reward",
        reason: "A reward at the range start",
        clientRequestId: randomUUID(),
      },
      "lisa",
      db,
      from,
    );
    addCorrection(1, "2026-08-20T13:00:00.000Z");
    addCorrection(4, to);

    const history = getHistory(from, to, db);
    expect(history.range).toEqual({ from, to });
    expect(history.openingStars).toEqual({
      balance: 3,
      happyCount: 5,
      trickyCount: 1,
      completedSkillCount: 1,
      effectiveHappyCount: 10,
      automaticEarned: 1,
      adjustmentTotal: 2,
      progress: 0,
      target: 10,
    });
    expect(history.progressEvents).toEqual([
      { kind: "skill", occurredAt: from },
      { kind: "tricky", occurredAt: from },
      { kind: "happy", occurredAt: "2026-08-15T12:00:00.000Z" },
    ]);
    expect(history.adjustments).toEqual([
      { delta: -1, kind: "reward", createdAt: from },
      {
        delta: 1,
        kind: "correction",
        createdAt: "2026-08-20T13:00:00.000Z",
      },
    ]);
  });

  it("keeps facts exactly at from out of the opening state", () => {
    const from = "2026-08-01T00:00:00.000Z";
    const to = "2026-08-02T00:00:00.000Z";
    addBehavior("sad", "2026-07-20T12:00:00.000Z", "lisa");
    addBehavior("happy", "2026-07-21T12:00:00.000Z");
    const skill = addSkill("Tying his shoelaces", "2026-07-22T12:00:00.000Z");
    completeSkill(skill, from);
    addCorrection(1, from);

    const history = getHistory(from, to, db);
    expect(history.openingStars).toEqual({
      happyCount: 1,
      trickyCount: 1,
      completedSkillCount: 0,
      effectiveHappyCount: 1,
      automaticEarned: 0,
      adjustmentTotal: 0,
      balance: 0,
      progress: 1,
      target: 10,
    });
    expect(history.progressEvents).toEqual([
      { kind: "skill", occurredAt: from },
    ]);
    expect(history.adjustments).toEqual([
      { delta: 1, kind: "correction", createdAt: from },
    ]);
  });
});
