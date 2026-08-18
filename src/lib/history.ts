import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  format,
  isSameMonth,
  isSameYear,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
} from "date-fns";

import type { HistoryPayload } from "@/lib/types";
import { applyProgressEvent } from "@/lib/progress";

export type HistoryPeriod = "week" | "month" | "quarter";

export interface HistoryWindowBucket {
  start: Date;
  end: Date;
  label: string;
  shortLabel: string;
}

export interface HistoryWindow {
  period: HistoryPeriod;
  start: Date;
  end: Date;
  label: string;
  buckets: HistoryWindowBucket[];
}

export interface HistoryBucket extends HistoryWindowBucket {
  happy: number;
  tricky: number;
  skills: number;
  automaticStars: number;
  correctionsAdded: number;
  correctionsRemoved: number;
  rewardsSpent: number;
  adjustmentDelta: number;
  netStarChange: number;
  closingProgress: number;
  closingBalance: number;
}

export interface HistorySummary {
  happy: number;
  tricky: number;
  skills: number;
  automaticStars: number;
  correctionsAdded: number;
  correctionsRemoved: number;
  rewardsSpent: number;
  netStarChange: number;
  openingBalance: number;
  closingProgress: number;
  closingBalance: number;
}

function earlier(left: Date, right: Date): Date {
  return left.getTime() < right.getTime() ? left : right;
}

function rangeLabel(start: Date, endExclusive: Date): string {
  const end = addDays(endExclusive, -1);
  if (isSameMonth(start, end)) {
    return `${format(start, "d")}–${format(end, "d MMMM yyyy")}`;
  }
  if (isSameYear(start, end)) {
    return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
  }
  return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
}

export function getHistoryWindow(
  period: HistoryPeriod,
  anchor: Date,
): HistoryWindow {
  if (period === "week") {
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const end = addWeeks(start, 1);
    const buckets = Array.from({ length: 7 }, (_, index) => {
      const bucketStart = addDays(start, index);
      return {
        start: bucketStart,
        end: addDays(bucketStart, 1),
        label: format(bucketStart, "EEEE d MMMM"),
        shortLabel: format(bucketStart, "EEE"),
      };
    });
    return {
      period,
      start,
      end,
      label: rangeLabel(start, end),
      buckets,
    };
  }

  if (period === "month") {
    const start = startOfMonth(anchor);
    const end = addMonths(start, 1);
    const buckets: HistoryWindowBucket[] = [];
    let cursor = start;
    while (cursor.getTime() < end.getTime()) {
      const nextMonday = addWeeks(startOfWeek(cursor, { weekStartsOn: 1 }), 1);
      const bucketEnd = earlier(nextMonday, end);
      const finalDay = addDays(bucketEnd, -1);
      buckets.push({
        start: cursor,
        end: bucketEnd,
        label: `${format(cursor, "d MMM")} – ${format(finalDay, "d MMM")}`,
        shortLabel:
          cursor.getDate() === finalDay.getDate()
            ? format(cursor, "d")
            : `${format(cursor, "d")}–${format(finalDay, "d")}`,
      });
      cursor = bucketEnd;
    }
    return {
      period,
      start,
      end,
      label: format(start, "MMMM yyyy"),
      buckets,
    };
  }

  const start = startOfQuarter(anchor);
  const end = addQuarters(start, 1);
  const buckets = Array.from({ length: 3 }, (_, index) => {
    const bucketStart = addMonths(start, index);
    return {
      start: bucketStart,
      end: addMonths(bucketStart, 1),
      label: format(bucketStart, "MMMM yyyy"),
      shortLabel: format(bucketStart, "MMM"),
    };
  });
  return {
    period,
    start,
    end,
    label: `Q${Math.floor(start.getMonth() / 3) + 1} ${format(start, "yyyy")}`,
    buckets,
  };
}

export function shiftHistoryAnchor(
  period: HistoryPeriod,
  anchor: Date,
  direction: -1 | 1,
): Date {
  if (period === "week") return addWeeks(anchor, direction);
  if (period === "month") return addMonths(anchor, direction);
  return addQuarters(anchor, direction);
}

export function buildHistoryBuckets(
  payload: HistoryPayload,
  window: HistoryWindow,
): HistoryBucket[] {
  let runningProgress = payload.openingStars.effectiveHappyCount;
  let runningAdjustment = payload.openingStars.adjustmentTotal;

  return window.buckets.map((bucket) => {
    const from = bucket.start.getTime();
    const to = bucket.end.getTime();
    const progressEvents = payload.progressEvents.filter((event) => {
      const time = Date.parse(event.occurredAt);
      return time >= from && time < to;
    });
    const adjustments = payload.adjustments.filter((adjustment) => {
      const time = Date.parse(adjustment.createdAt);
      return time >= from && time < to;
    });
    const happy = progressEvents.filter(
      (event) => event.kind === "happy",
    ).length;
    const tricky = progressEvents.filter(
      (event) => event.kind === "tricky",
    ).length;
    const skills = progressEvents.filter(
      (event) => event.kind === "skill",
    ).length;
    const automaticBefore = Math.floor(runningProgress / 10);
    for (const event of progressEvents) {
      runningProgress = applyProgressEvent(runningProgress, event.kind);
    }
    const automaticAfter = Math.floor(runningProgress / 10);
    const automaticStars = automaticAfter - automaticBefore;

    let correctionsAdded = 0;
    let correctionsRemoved = 0;
    let rewardsSpent = 0;
    let adjustmentDelta = 0;
    for (const adjustment of adjustments) {
      adjustmentDelta += adjustment.delta;
      if (adjustment.kind === "reward") {
        rewardsSpent += Math.abs(adjustment.delta);
      } else if (adjustment.delta > 0) {
        correctionsAdded += adjustment.delta;
      } else {
        correctionsRemoved += Math.abs(adjustment.delta);
      }
    }
    runningAdjustment += adjustmentDelta;
    const netStarChange = automaticStars + adjustmentDelta;

    return {
      ...bucket,
      happy,
      tricky,
      skills,
      automaticStars,
      correctionsAdded,
      correctionsRemoved,
      rewardsSpent,
      adjustmentDelta,
      netStarChange,
      closingProgress: runningProgress % 10,
      closingBalance: automaticAfter + runningAdjustment,
    };
  });
}

export function summarizeHistory(
  payload: HistoryPayload,
  buckets: HistoryBucket[],
): HistorySummary {
  const totals = buckets.reduce(
    (summary, bucket) => ({
      happy: summary.happy + bucket.happy,
      tricky: summary.tricky + bucket.tricky,
      skills: summary.skills + bucket.skills,
      automaticStars: summary.automaticStars + bucket.automaticStars,
      correctionsAdded: summary.correctionsAdded + bucket.correctionsAdded,
      correctionsRemoved:
        summary.correctionsRemoved + bucket.correctionsRemoved,
      rewardsSpent: summary.rewardsSpent + bucket.rewardsSpent,
      netStarChange: summary.netStarChange + bucket.netStarChange,
    }),
    {
      happy: 0,
      tricky: 0,
      skills: 0,
      automaticStars: 0,
      correctionsAdded: 0,
      correctionsRemoved: 0,
      rewardsSpent: 0,
      netStarChange: 0,
    },
  );
  return {
    ...totals,
    openingBalance: payload.openingStars.balance,
    closingProgress:
      buckets.at(-1)?.closingProgress ?? payload.openingStars.progress,
    closingBalance:
      buckets.at(-1)?.closingBalance ?? payload.openingStars.balance,
  };
}
