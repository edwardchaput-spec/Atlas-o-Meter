import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHistoryBuckets,
  getHistoryWindow,
  shiftHistoryAnchor,
  summarizeHistory,
} from "@/lib/history";
import { calculateStarSummary } from "@/lib/progress";
import type {
  HistoryPayload,
  ProgressEventKind,
  StarSummary,
} from "@/lib/types";

const originalTimeZone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Europe/London";
});

afterAll(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

function dateParts(date: Date): [number, number, number, number] {
  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
  ];
}

function isoWithin(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function starSummary(
  kinds: readonly ProgressEventKind[],
  adjustmentTotal: number,
): StarSummary {
  return calculateStarSummary(
    kinds.map((kind) => ({ kind })),
    adjustmentTotal,
  );
}

describe("history windows", () => {
  it("builds Monday-to-Sunday week buckets with half-open day boundaries", () => {
    const window = getHistoryWindow("week", new Date(2026, 7, 9, 12));

    expect(window.label).toBe("3–9 August 2026");
    expect(dateParts(window.start)).toEqual([2026, 8, 3, 0]);
    expect(dateParts(window.end)).toEqual([2026, 8, 10, 0]);
    expect(window.buckets).toHaveLength(7);
    expect(window.buckets.map(({ shortLabel }) => shortLabel)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    for (let index = 0; index < window.buckets.length - 1; index += 1) {
      expect(window.buckets[index].end.getTime()).toBe(
        window.buckets[index + 1].start.getTime(),
      );
    }
  });

  it("splits a month on Monday boundaries and a quarter into calendar months", () => {
    const month = getHistoryWindow("month", new Date(2026, 7, 9, 12));
    expect(month.label).toBe("August 2026");
    expect(month.buckets.map(({ shortLabel }) => shortLabel)).toEqual([
      "1–2",
      "3–9",
      "10–16",
      "17–23",
      "24–30",
      "31",
    ]);
    expect(dateParts(month.start)).toEqual([2026, 8, 1, 0]);
    expect(dateParts(month.end)).toEqual([2026, 9, 1, 0]);

    const quarter = getHistoryWindow("quarter", new Date(2026, 7, 9, 12));
    expect(quarter.label).toBe("Q3 2026");
    expect(quarter.buckets.map(({ shortLabel }) => shortLabel)).toEqual([
      "Jul",
      "Aug",
      "Sep",
    ]);
    expect(dateParts(quarter.start)).toEqual([2026, 7, 1, 0]);
    expect(dateParts(quarter.end)).toEqual([2026, 10, 1, 0]);
  });

  it("shifts anchors by the selected calendar period", () => {
    const anchor = new Date(2026, 7, 31, 12);
    expect(dateParts(shiftHistoryAnchor("week", anchor, -1))).toEqual([
      2026, 8, 24, 12,
    ]);
    expect(dateParts(shiftHistoryAnchor("month", anchor, 1))).toEqual([
      2026, 9, 30, 12,
    ]);
    expect(dateParts(shiftHistoryAnchor("quarter", anchor, 1))).toEqual([
      2026, 11, 30, 12,
    ]);
  });

  it("keeps local-midnight buckets across the UK spring DST transition", () => {
    const window = getHistoryWindow("week", new Date(2026, 2, 29, 12));
    const sunday = window.buckets[6];

    expect(dateParts(sunday.start)).toEqual([2026, 3, 29, 0]);
    expect(dateParts(sunday.end)).toEqual([2026, 3, 30, 0]);
    expect(sunday.end.getTime() - sunday.start.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
    expect(window.end.getTime() - window.start.getTime()).toBe(
      167 * 60 * 60 * 1000,
    );
  });
});

describe("history bucket derivation", () => {
  it("preserves chronological tricky-at-zero saturation inside a bucket", () => {
    const window = getHistoryWindow("week", new Date(2026, 7, 5, 12));
    const first = window.buckets[0];
    const base = {
      range: {
        from: window.start.toISOString(),
        to: window.end.toISOString(),
      },
      openingStars: starSummary([], 0),
      adjustments: [],
      syncedAt: "2026-08-09T12:00:00.000Z",
    } satisfies Omit<HistoryPayload, "progressEvents">;

    const trickyThenHappy = buildHistoryBuckets(
      {
        ...base,
        progressEvents: [
          { kind: "tricky", occurredAt: isoWithin(first.start, 1_000) },
          { kind: "happy", occurredAt: isoWithin(first.start, 2_000) },
        ],
      },
      window,
    );
    const happyThenTricky = buildHistoryBuckets(
      {
        ...base,
        progressEvents: [
          { kind: "happy", occurredAt: isoWithin(first.start, 1_000) },
          { kind: "tricky", occurredAt: isoWithin(first.start, 2_000) },
        ],
      },
      window,
    );

    expect(trickyThenHappy[0]).toMatchObject({
      happy: 1,
      tricky: 1,
      skills: 0,
      automaticStars: 0,
      closingProgress: 1,
      closingBalance: 0,
    });
    expect(happyThenTricky[0]).toMatchObject({
      happy: 1,
      tricky: 1,
      skills: 0,
      automaticStars: 0,
      closingProgress: 0,
      closingBalance: 0,
    });
  });

  it("attributes skill gains and tricky reversals as signed star movement", () => {
    const window = getHistoryWindow("week", new Date(2026, 7, 5, 12));
    const first = window.buckets[0];
    const second = window.buckets[1];
    const third = window.buckets[2];
    const payload: HistoryPayload = {
      range: {
        from: window.start.toISOString(),
        to: window.end.toISOString(),
      },
      openingStars: starSummary(Array(5).fill("happy"), 0),
      progressEvents: [
        { kind: "skill", occurredAt: isoWithin(first.start, 60 * 60 * 1000) },
        { kind: "tricky", occurredAt: isoWithin(second.start, 60 * 60 * 1000) },
        // An event on a bucket boundary belongs to that following bucket.
        { kind: "happy", occurredAt: third.start.toISOString() },
        // The overall range is half-open, so this is not assigned a bucket.
        { kind: "happy", occurredAt: window.end.toISOString() },
      ],
      adjustments: [
        {
          delta: 2,
          kind: "correction",
          createdAt: isoWithin(first.start, 3 * 60 * 60 * 1000),
        },
        {
          delta: -1,
          kind: "correction",
          createdAt: isoWithin(first.start, 4 * 60 * 60 * 1000),
        },
        {
          delta: -1,
          kind: "reward",
          createdAt: isoWithin(first.start, 5 * 60 * 60 * 1000),
        },
        {
          delta: -1,
          kind: "reward",
          createdAt: isoWithin(second.start, 2 * 60 * 60 * 1000),
        },
      ],
      syncedAt: "2026-08-09T12:00:00.000Z",
    };

    const buckets = buildHistoryBuckets(payload, window);
    expect(buckets[0]).toMatchObject({
      happy: 0,
      tricky: 0,
      skills: 1,
      automaticStars: 1,
      correctionsAdded: 2,
      correctionsRemoved: 1,
      rewardsSpent: 1,
      adjustmentDelta: 0,
      netStarChange: 1,
      closingProgress: 0,
      closingBalance: 1,
    });
    expect(buckets[1]).toMatchObject({
      happy: 0,
      tricky: 1,
      skills: 0,
      automaticStars: -1,
      rewardsSpent: 1,
      adjustmentDelta: -1,
      netStarChange: -2,
      closingProgress: 9,
      closingBalance: -1,
    });
    expect(buckets[2]).toMatchObject({
      happy: 1,
      tricky: 0,
      skills: 0,
      automaticStars: 1,
      closingProgress: 0,
      closingBalance: 0,
    });

    expect(summarizeHistory(payload, buckets)).toEqual({
      happy: 1,
      tricky: 1,
      skills: 1,
      automaticStars: 1,
      correctionsAdded: 2,
      correctionsRemoved: 1,
      rewardsSpent: 2,
      netStarChange: 0,
      openingBalance: 0,
      closingProgress: 0,
      closingBalance: 0,
    });
  });

  it("carries opening automatic and corrected stars through empty buckets", () => {
    const window = getHistoryWindow("quarter", new Date(2026, 7, 5, 12));
    const payload: HistoryPayload = {
      range: {
        from: window.start.toISOString(),
        to: window.end.toISOString(),
      },
      openingStars: starSummary(Array(20).fill("happy"), -1),
      progressEvents: [],
      adjustments: [],
      syncedAt: "2026-08-09T12:00:00.000Z",
    };

    const buckets = buildHistoryBuckets(payload, window);
    expect(buckets.map(({ closingBalance }) => closingBalance)).toEqual([
      1, 1, 1,
    ]);
    expect(summarizeHistory(payload, buckets)).toMatchObject({
      openingBalance: 1,
      closingBalance: 1,
      closingProgress: 0,
      netStarChange: 0,
    });
  });
});
