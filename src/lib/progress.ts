import type {
  HistoryProgressFact,
  ProgressEventKind,
  StarSummary,
} from "@/lib/types";

export const STAR_FACE_TARGET = 10 as const;
export const SKILL_FACE_VALUE = 5 as const;

/**
 * Apply one chronologically ordered progress event.
 *
 * Tricky moments saturate at zero. In particular, a tricky moment received
 * while Atlas has no happy-face progress does not create debt against a later
 * happy moment.
 */
export function applyProgressEvent(
  current: number,
  kind: ProgressEventKind,
): number {
  if (kind === "happy") return current + 1;
  if (kind === "skill") return current + SKILL_FACE_VALUE;
  return Math.max(0, current - 1);
}

export function foldProgressEvents(
  events: readonly Pick<HistoryProgressFact, "kind">[],
  opening = 0,
): number {
  return events.reduce(
    (current, event) => applyProgressEvent(current, event.kind),
    Math.max(0, opening),
  );
}

export function calculateStarSummary(
  events: readonly Pick<HistoryProgressFact, "kind">[],
  adjustmentTotal: number,
): StarSummary {
  let happyCount = 0;
  let trickyCount = 0;
  let completedSkillCount = 0;

  for (const event of events) {
    if (event.kind === "happy") happyCount += 1;
    else if (event.kind === "tricky") trickyCount += 1;
    else completedSkillCount += 1;
  }

  const effectiveHappyCount = foldProgressEvents(events);
  const automaticEarned = Math.floor(effectiveHappyCount / STAR_FACE_TARGET);

  return {
    balance: automaticEarned + adjustmentTotal,
    happyCount,
    trickyCount,
    completedSkillCount,
    effectiveHappyCount,
    automaticEarned,
    adjustmentTotal,
    progress: effectiveHappyCount % STAR_FACE_TARGET,
    target: STAR_FACE_TARGET,
  };
}
