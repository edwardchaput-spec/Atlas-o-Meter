import { describe, expect, it } from "vitest";

import {
  applyProgressEvent,
  calculateStarSummary,
  foldProgressEvents,
  SKILL_FACE_VALUE,
  STAR_FACE_TARGET,
} from "@/lib/progress";
import type { ProgressEventKind } from "@/lib/types";

function events(...kinds: ProgressEventKind[]) {
  return kinds.map((kind) => ({ kind }));
}

describe("ordered happy-face progress", () => {
  it("saturates each tricky moment at zero instead of banking future debt", () => {
    expect(applyProgressEvent(0, "tricky")).toBe(0);
    expect(foldProgressEvents(events("tricky", "happy"))).toBe(1);
    expect(foldProgressEvents(events("happy", "tricky"))).toBe(0);
    expect(foldProgressEvents(events("tricky", "tricky", "happy"))).toBe(1);
  });

  it("adds five exactly once for each completed-skill event", () => {
    expect(SKILL_FACE_VALUE).toBe(5);
    expect(foldProgressEvents(events("happy", "skill"))).toBe(6);
    expect(foldProgressEvents(events("skill", "tricky"))).toBe(4);
  });

  it("earns and reverses automatic stars at ordered boundaries", () => {
    expect(STAR_FACE_TARGET).toBe(10);
    const nineHappy = Array.from({ length: 9 }, () => "happy" as const);

    expect(
      calculateStarSummary(events(...nineHappy, "happy"), 0),
    ).toMatchObject({
      effectiveHappyCount: 10,
      automaticEarned: 1,
      progress: 0,
      balance: 1,
    });
    expect(
      calculateStarSummary(events(...nineHappy, "happy", "tricky"), 0),
    ).toMatchObject({
      happyCount: 10,
      trickyCount: 1,
      effectiveHappyCount: 9,
      automaticEarned: 0,
      progress: 9,
      balance: 0,
    });
    expect(calculateStarSummary(events(...nineHappy, "skill"), -1)).toEqual({
      balance: 0,
      happyCount: 9,
      trickyCount: 0,
      completedSkillCount: 1,
      effectiveHappyCount: 14,
      automaticEarned: 1,
      adjustmentTotal: -1,
      progress: 4,
      target: 10,
    });
  });
});
