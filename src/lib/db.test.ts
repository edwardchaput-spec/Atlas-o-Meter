import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createBehavior,
  createDatabase,
  createSkill,
  createStarAdjustment,
  deleteBehavior,
  getDashboard,
  getStarSummary,
  softDeleteSkill,
  updateBehavior,
  updateSkill,
} from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { BehaviorEntry, UserSlug } from "@/lib/types";

const OCCURRED_AT = "2026-08-09T10:00:00.000Z";
const CREATED_AT = "2026-08-09T10:01:00.000Z";

describe("SQLite repository", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function addBehavior(
    mood: "happy" | "sad" = "happy",
    actor: UserSlug = "edward",
    options: {
      tag?: string | null;
      requestId?: string;
      occurredAt?: string;
      now?: string;
    } = {},
  ) {
    return createBehavior(
      {
        mood,
        occurredAt: options.occurredAt ?? OCCURRED_AT,
        tag: options.tag ?? null,
        clientRequestId: options.requestId ?? randomUUID(),
      },
      actor,
      db,
      options.now ?? CREATED_AT,
    );
  }

  function addHappyFaces(count: number): BehaviorEntry[] {
    return Array.from({ length: count }, () => addBehavior().behavior);
  }

  function addSkill(
    name = "Tying his shoelaces",
    actor: UserSlug = "edward",
    options: { requestId?: string; now?: string } = {},
  ) {
    return createSkill(
      {
        name,
        clientRequestId: options.requestId ?? randomUUID(),
      },
      actor,
      db,
      options.now ?? CREATED_AT,
    );
  }

  function expectAppError(
    action: () => unknown,
    status: number,
    code: string,
  ): void {
    try {
      action();
      throw new Error("Expected an AppError to be thrown.");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status, code });
    }
  }

  it("applies tricky moments chronologically, saturates at zero, and reverses a star", () => {
    const trickyAtZero = addBehavior("sad", "lisa", {
      occurredAt: "2026-08-09T08:00:00.000Z",
      now: "2026-08-09T08:01:00.000Z",
    });
    expect(trickyAtZero.stars).toMatchObject({
      happyCount: 0,
      trickyCount: 1,
      effectiveHappyCount: 0,
      automaticEarned: 0,
      balance: 0,
      progress: 0,
    });

    addHappyFaces(9);
    expect(getStarSummary(db)).toEqual({
      happyCount: 9,
      trickyCount: 1,
      completedSkillCount: 0,
      effectiveHappyCount: 9,
      automaticEarned: 0,
      adjustmentTotal: 0,
      balance: 0,
      progress: 9,
      target: 10,
    });

    const tenth = addBehavior();
    expect(tenth.stars).toEqual({
      happyCount: 10,
      trickyCount: 1,
      completedSkillCount: 0,
      effectiveHappyCount: 10,
      automaticEarned: 1,
      adjustmentTotal: 0,
      balance: 1,
      progress: 0,
      target: 10,
    });

    const laterTricky = addBehavior("sad", "edward", {
      occurredAt: "2026-08-09T11:00:00.000Z",
      now: "2026-08-09T11:01:00.000Z",
    });
    expect(laterTricky.stars).toMatchObject({
      happyCount: 10,
      trickyCount: 2,
      effectiveHappyCount: 9,
      automaticEarned: 0,
      balance: 0,
      progress: 9,
    });
  });

  it("uses a deterministic kind fallback when event and record times tie exactly", () => {
    const tiedAt = "2026-08-09T10:00:00.000Z";
    // Insert tricky first to prove database commit order is not the tie-breaker.
    addBehavior("sad", "lisa", { occurredAt: tiedAt, now: tiedAt });
    addBehavior("happy", "edward", { occurredAt: tiedAt, now: tiedAt });

    expect(getStarSummary(db)).toMatchObject({
      happyCount: 1,
      trickyCount: 1,
      effectiveHappyCount: 0,
      progress: 0,
    });
  });

  it("deduplicates behavior and adjustment retries per actor", () => {
    const behaviorRequestId = randomUUID();
    const first = addBehavior("happy", "edward", {
      requestId: behaviorRequestId,
      tag: "Helping",
    });
    const retry = addBehavior("sad", "edward", {
      requestId: behaviorRequestId,
      tag: "Different retry payload",
    });
    const sameRequestFromLisa = addBehavior("sad", "lisa", {
      requestId: behaviorRequestId,
      occurredAt: "2026-08-09T09:00:00.000Z",
      now: "2026-08-09T09:01:00.000Z",
    });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.behavior).toEqual(first.behavior);
    expect(retry.stars.happyCount).toBe(1);
    expect(sameRequestFromLisa.created).toBe(true);
    expect(sameRequestFromLisa.behavior.id).not.toBe(first.behavior.id);

    addHappyFaces(9);
    const adjustmentRequestId = randomUUID();
    const adjustment = createStarAdjustment(
      {
        delta: 2,
        kind: "correction",
        reason: "Two stars were missed",
        clientRequestId: adjustmentRequestId,
      },
      "edward",
      db,
      "2026-08-09T11:00:00.000Z",
    );
    const adjustmentRetry = createStarAdjustment(
      {
        delta: -1,
        kind: "correction",
        reason: "A changed retry must not be applied",
        clientRequestId: adjustmentRequestId,
      },
      "edward",
      db,
      "2026-08-09T11:01:00.000Z",
    );
    const lisaAdjustment = createStarAdjustment(
      {
        delta: 1,
        kind: "correction",
        reason: "Lisa has a separate request scope",
        clientRequestId: adjustmentRequestId,
      },
      "lisa",
      db,
      "2026-08-09T11:02:00.000Z",
    );

    expect(adjustment.created).toBe(true);
    expect(adjustmentRetry.created).toBe(false);
    expect(adjustmentRetry.adjustment).toEqual(adjustment.adjustment);
    expect(adjustmentRetry.stars.balance).toBe(3);
    expect(lisaAdjustment.created).toBe(true);
    expect(lisaAdjustment.adjustment.id).not.toBe(adjustment.adjustment.id);
    expect(lisaAdjustment.stars.balance).toBe(4);
  });

  it("reuses normalized tags across actors while preserving display and audit data", () => {
    const first = addBehavior("happy", "edward", {
      tag: "  Tidying    up ",
      now: "2026-08-09T09:00:00.000Z",
    });
    const second = addBehavior("sad", "lisa", {
      tag: "ＴＩＤＹＩＮＧ\u3000ＵＰ",
      now: "2026-08-09T09:05:00.000Z",
    });
    const untagged = addBehavior("happy", "lisa", { tag: " \n\t " });

    expect(first.behavior.tag).toEqual(
      expect.objectContaining({ name: "Tidying up" }),
    );
    expect(second.behavior.tag).toEqual(first.behavior.tag);
    expect(untagged.behavior.tag).toBeNull();

    const dashboard = getDashboard(
      "2026-08-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
      db,
    );
    expect(dashboard.tags).toHaveLength(1);
    expect(dashboard.tags[0]).toMatchObject({
      id: first.behavior.tag?.id,
      name: "Tidying up",
      usageCount: 2,
      createdBy: "edward",
      createdAt: "2026-08-09T09:00:00.000Z",
    });

    const stored = db.prepare("SELECT normalized_name FROM tags").get() as {
      normalized_name: string;
    };
    expect(stored.normalized_name).toBe("tidying up");
  });

  it("shares, converges, audits, versions, and soft-deletes skills across actors", () => {
    const lisaRequestId = randomUUID();
    const edwardRequestId = randomUUID();
    const first = addSkill("  Ｔｙｉｎｇ   his shoelaces ", "lisa", {
      requestId: lisaRequestId,
      now: "2026-08-09T09:00:00.000Z",
    });
    const canonical = addSkill("TYING HIS SHOELACES", "edward", {
      requestId: edwardRequestId,
      now: "2026-08-09T09:05:00.000Z",
    });

    expect(first.created).toBe(true);
    expect(first.skill).toMatchObject({
      name: "Tying his shoelaces",
      createdBy: "lisa",
      createdAt: "2026-08-09T09:00:00.000Z",
      updatedBy: "lisa",
      version: 1,
      completedBy: null,
      completedAt: null,
    });
    expect(canonical).toMatchObject({
      created: false,
      skill: first.skill,
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM skills").get()).toEqual({
      count: 1,
    });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM skill_create_requests").get(),
    ).toEqual({ count: 2 });

    const other = addSkill("Riding a bike", "edward", {
      now: "2026-08-09T09:10:00.000Z",
    });
    expectAppError(
      () =>
        updateSkill(
          first.skill.id,
          { name: "  RIDING A BIKE ", version: 1 },
          "lisa",
          db,
          "2026-08-09T09:20:00.000Z",
        ),
      409,
      "SKILL_EXISTS",
    );

    const renamed = updateSkill(
      first.skill.id,
      { name: "Doing his shoelaces", version: 1 },
      "edward",
      db,
      "2026-08-09T09:30:00.000Z",
    ).skill;
    expect(renamed).toMatchObject({
      name: "Doing his shoelaces",
      createdBy: "lisa",
      updatedBy: "edward",
      updatedAt: "2026-08-09T09:30:00.000Z",
      version: 2,
    });
    expectAppError(
      () =>
        updateSkill(
          first.skill.id,
          { completed: true, version: 1 },
          "lisa",
          db,
        ),
      409,
      "STALE_SKILL",
    );

    const mappedRetry = addSkill("A changed retry payload", "edward", {
      requestId: edwardRequestId,
      now: "2026-08-09T10:00:00.000Z",
    });
    expect(mappedRetry).toMatchObject({ created: false, skill: renamed });

    expectAppError(
      () => softDeleteSkill(renamed.id, 1, "lisa", db),
      409,
      "STALE_SKILL",
    );
    softDeleteSkill(
      renamed.id,
      renamed.version,
      "lisa",
      db,
      "2026-08-09T10:30:00.000Z",
    );
    const deletedAudit = db
      .prepare(
        `SELECT deleted_by, deleted_at, updated_by, updated_at, version
         FROM skills WHERE id = ?`,
      )
      .get(renamed.id);
    expect(deletedAudit).toEqual({
      deleted_by: "lisa",
      deleted_at: "2026-08-09T10:30:00.000Z",
      updated_by: "lisa",
      updated_at: "2026-08-09T10:30:00.000Z",
      version: 3,
    });
    expect(
      getDashboard(
        "2026-08-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
        db,
      ).skills.map(({ id }) => id),
    ).toEqual([other.skill.id]);

    const retryAfterDelete = addSkill("Still a changed retry", "edward", {
      requestId: edwardRequestId,
      now: "2026-08-09T11:00:00.000Z",
    });
    expect(retryAfterDelete).toMatchObject({
      created: false,
      skill: { id: renamed.id, name: renamed.name, version: 3 },
    });

    const recreated = addSkill("Doing his shoelaces", "edward", {
      now: "2026-08-09T11:30:00.000Z",
    });
    expect(recreated.created).toBe(true);
    expect(recreated.skill.id).not.toBe(renamed.id);
  });

  it("adds five faces once for completion and recalculates on reopen", () => {
    addHappyFaces(5);
    const created = addSkill("Tying his shoelaces", "edward", {
      now: "2026-08-09T10:30:00.000Z",
    });

    const completed = updateSkill(
      created.skill.id,
      { completed: true, version: created.skill.version },
      "lisa",
      db,
      "2026-08-09T11:00:00.000Z",
    );
    expect(completed.skill).toMatchObject({
      createdBy: "edward",
      completedBy: "lisa",
      completedAt: "2026-08-09T11:00:00.000Z",
      updatedBy: "lisa",
      version: 2,
    });
    expect(completed.stars).toMatchObject({
      happyCount: 5,
      trickyCount: 0,
      completedSkillCount: 1,
      effectiveHappyCount: 10,
      automaticEarned: 1,
      progress: 0,
      balance: 1,
    });

    const repeated = updateSkill(
      completed.skill.id,
      { completed: true, version: completed.skill.version },
      "edward",
      db,
      "2026-08-09T11:05:00.000Z",
    );
    expect(repeated.skill).toEqual(completed.skill);
    expect(repeated.stars.completedSkillCount).toBe(1);
    expect(repeated.stars.effectiveHappyCount).toBe(10);

    const renamedWhileComplete = updateSkill(
      completed.skill.id,
      { name: "Doing his shoelaces", version: completed.skill.version },
      "edward",
      db,
      "2026-08-09T11:10:00.000Z",
    );
    expect(renamedWhileComplete.skill).toMatchObject({
      completedBy: "lisa",
      completedAt: "2026-08-09T11:00:00.000Z",
      version: 3,
    });
    expectAppError(
      () =>
        updateSkill(
          completed.skill.id,
          { completed: true, version: completed.skill.version },
          "lisa",
          db,
          "2026-08-09T11:15:00.000Z",
        ),
      409,
      "STALE_SKILL",
    );

    const spent = createStarAdjustment(
      {
        delta: -1,
        kind: "reward",
        reason: "Choose tonight's story",
        clientRequestId: randomUUID(),
      },
      "edward",
      db,
      "2026-08-09T11:30:00.000Z",
    );
    expect(spent.stars.balance).toBe(0);

    addBehavior("sad", "lisa", {
      occurredAt: "2026-08-09T12:00:00.000Z",
      now: "2026-08-09T12:01:00.000Z",
    });
    expect(getStarSummary(db)).toMatchObject({
      effectiveHappyCount: 9,
      automaticEarned: 0,
      adjustmentTotal: -1,
      balance: -1,
    });

    const reopened = updateSkill(
      renamedWhileComplete.skill.id,
      { completed: false, version: renamedWhileComplete.skill.version },
      "edward",
      db,
      "2026-08-09T13:00:00.000Z",
    );
    expect(reopened.skill).toMatchObject({
      completedBy: null,
      completedAt: null,
      updatedBy: "edward",
      version: 4,
    });
    expect(reopened.stars).toMatchObject({
      completedSkillCount: 0,
      effectiveHappyCount: 4,
      automaticEarned: 0,
      progress: 4,
      balance: -1,
    });

    expectAppError(
      () =>
        createStarAdjustment(
          {
            delta: -1,
            kind: "reward",
            reason: "No automatic star remains",
            clientRequestId: randomUUID(),
          },
          "lisa",
          db,
        ),
      409,
      "INSUFFICIENT_STARS",
    );
  });

  it("recalculates stars after updates and soft deletion and records each actor", () => {
    const behaviors = addHappyFaces(10);
    const original = behaviors[0];
    expect(getStarSummary(db).balance).toBe(1);

    const madeSad = updateBehavior(
      original.id,
      {
        mood: "sad",
        occurredAt: "2026-08-09T12:00:00.000Z",
        tag: "Throwing toys",
        version: 1,
      },
      "lisa",
      db,
      "2026-08-09T12:01:00.000Z",
    );
    expect(madeSad.stars).toMatchObject({
      happyCount: 9,
      trickyCount: 1,
      effectiveHappyCount: 8,
      automaticEarned: 0,
      balance: 0,
      progress: 8,
    });
    expect(madeSad.behavior).toMatchObject({
      createdBy: "edward",
      createdAt: CREATED_AT,
      updatedBy: "lisa",
      updatedAt: "2026-08-09T12:01:00.000Z",
      version: 2,
    });

    expectAppError(
      () =>
        updateBehavior(
          original.id,
          {
            mood: "happy",
            occurredAt: OCCURRED_AT,
            tag: null,
            version: 1,
          },
          "edward",
          db,
        ),
      409,
      "STALE_ENTRY",
    );

    const madeHappyAgain = updateBehavior(
      original.id,
      {
        mood: "happy",
        occurredAt: OCCURRED_AT,
        tag: null,
        version: 2,
      },
      "edward",
      db,
      "2026-08-09T12:02:00.000Z",
    );
    expect(madeHappyAgain.stars).toMatchObject({
      happyCount: 10,
      automaticEarned: 1,
      balance: 1,
      progress: 0,
    });

    const removed = deleteBehavior(
      original.id,
      madeHappyAgain.behavior.version,
      "lisa",
      db,
      "2026-08-09T12:03:00.000Z",
    );
    expect(removed.stars).toMatchObject({
      happyCount: 9,
      automaticEarned: 0,
      balance: 0,
      progress: 9,
    });

    const deletedAudit = db
      .prepare(
        `SELECT deleted_at, deleted_by, updated_at, updated_by, version
         FROM behaviors WHERE id = ?`,
      )
      .get(original.id) as {
      deleted_at: string;
      deleted_by: UserSlug;
      updated_at: string;
      updated_by: UserSlug;
      version: number;
    };
    expect(deletedAudit).toEqual({
      deleted_at: "2026-08-09T12:03:00.000Z",
      deleted_by: "lisa",
      updated_at: "2026-08-09T12:03:00.000Z",
      updated_by: "lisa",
      version: 4,
    });

    const dashboard = getDashboard(
      "2026-08-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
      db,
    );
    expect(dashboard.entries).toHaveLength(9);
    expect(dashboard.entries.some(({ id }) => id === original.id)).toBe(false);
  });

  it("rejects rewards above the available balance without recording them", () => {
    addHappyFaces(10);

    expectAppError(
      () =>
        createStarAdjustment(
          {
            delta: -2,
            kind: "reward",
            reason: "Reward costs two stars",
            clientRequestId: randomUUID(),
          },
          "lisa",
          db,
        ),
      409,
      "INSUFFICIENT_STARS",
    );
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM star_adjustments").get(),
    ).toEqual({ count: 0 });
    expect(getStarSummary(db).balance).toBe(1);

    const spent = createStarAdjustment(
      {
        delta: -1,
        kind: "reward",
        reason: "Choose the family film",
        clientRequestId: randomUUID(),
      },
      "lisa",
      db,
      "2026-08-09T18:00:00.000Z",
    );
    expect(spent.adjustment).toMatchObject({
      delta: -1,
      kind: "reward",
      reason: "Choose the family film",
      createdBy: "lisa",
      createdAt: "2026-08-09T18:00:00.000Z",
    });
    expect(spent.stars).toMatchObject({
      automaticEarned: 1,
      adjustmentTotal: -1,
      balance: 0,
    });

    expectAppError(
      () =>
        createStarAdjustment(
          {
            delta: -1,
            kind: "reward",
            reason: "No stars remain",
            clientRequestId: randomUUID(),
          },
          "edward",
          db,
        ),
      409,
      "INSUFFICIENT_STARS",
    );
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM star_adjustments").get(),
    ).toEqual({ count: 1 });
  });
});
