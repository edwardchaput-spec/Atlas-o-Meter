export const USER_SLUGS = ["edward", "lisa"] as const;

export type UserSlug = (typeof USER_SLUGS)[number];
export type Mood = "happy" | "sad";
export type AdjustmentKind = "correction" | "reward";
export type ProgressEventKind = "happy" | "tricky" | "skill";

export interface SessionUser {
  slug: UserSlug;
  displayName: "Edward" | "Lisa";
}

export interface TagSummary {
  id: string;
  name: string;
  usageCount: number;
  createdBy: UserSlug;
  createdAt: string;
}

export interface BehaviorEntry {
  id: string;
  mood: Mood;
  occurredAt: string;
  tag: { id: string; name: string } | null;
  createdBy: UserSlug;
  createdAt: string;
  updatedBy: UserSlug;
  updatedAt: string;
  version: number;
}

export interface SkillEntry {
  id: string;
  name: string;
  createdBy: UserSlug;
  createdAt: string;
  completedBy: UserSlug | null;
  completedAt: string | null;
  updatedBy: UserSlug;
  updatedAt: string;
  version: number;
}

export interface StarSummary {
  balance: number;
  happyCount: number;
  trickyCount: number;
  completedSkillCount: number;
  effectiveHappyCount: number;
  automaticEarned: number;
  adjustmentTotal: number;
  progress: number;
  target: 10;
}

export interface StarAdjustment {
  id: string;
  delta: number;
  kind: AdjustmentKind;
  reason: string;
  createdBy: UserSlug;
  createdAt: string;
}

export interface DashboardPayload {
  entries: BehaviorEntry[];
  tags: TagSummary[];
  skills: SkillEntry[];
  stars: StarSummary;
  adjustments: StarAdjustment[];
  syncedAt: string;
}

export interface HistoryProgressFact {
  kind: ProgressEventKind;
  occurredAt: string;
}

export interface HistoryAdjustmentFact {
  delta: number;
  kind: AdjustmentKind;
  createdAt: string;
}

export interface HistoryPayload {
  range: { from: string; to: string };
  openingStars: StarSummary;
  progressEvents: HistoryProgressFact[];
  adjustments: HistoryAdjustmentFact[];
  syncedAt: string;
}

export interface PasskeyStatus {
  count: number;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}
