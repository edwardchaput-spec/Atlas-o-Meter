import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import {
  cleanSkillName,
  cleanTagName,
  normalizeSkillName,
  normalizeTagName,
} from "@/lib/domain";
import { AppError } from "@/lib/errors";
import { calculateStarSummary } from "@/lib/progress";
import type {
  AdjustmentKind,
  BehaviorEntry,
  DashboardPayload,
  HistoryProgressFact,
  HistoryPayload,
  Mood,
  ProgressEventKind,
  SkillEntry,
  StarAdjustment,
  StarSummary,
  TagSummary,
  UserSlug,
} from "@/lib/types";

const INITIAL_SCHEMA = `
  CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 48),
    normalized_name TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL CHECK(created_by IN ('edward', 'lisa')),
    created_at TEXT NOT NULL,
    archived_at TEXT
  );

  CREATE TABLE behaviors (
    id TEXT PRIMARY KEY,
    mood TEXT NOT NULL CHECK(mood IN ('happy', 'sad')),
    occurred_at TEXT NOT NULL,
    tag_id TEXT REFERENCES tags(id),
    created_by TEXT NOT NULL CHECK(created_by IN ('edward', 'lisa')),
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL CHECK(updated_by IN ('edward', 'lisa')),
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    deleted_at TEXT,
    deleted_by TEXT CHECK(deleted_by IN ('edward', 'lisa')),
    client_request_id TEXT NOT NULL,
    UNIQUE(created_by, client_request_id)
  );

  CREATE TABLE star_adjustments (
    id TEXT PRIMARY KEY,
    delta INTEGER NOT NULL CHECK(delta BETWEEN -50 AND 50 AND delta <> 0),
    kind TEXT NOT NULL CHECK(kind IN ('correction', 'reward')),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 2 AND 80),
    created_by TEXT NOT NULL CHECK(created_by IN ('edward', 'lisa')),
    created_at TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    UNIQUE(created_by, client_request_id)
  );

  CREATE INDEX behaviors_active_occurred_at
    ON behaviors(occurred_at) WHERE deleted_at IS NULL;
  CREATE INDEX behaviors_active_mood
    ON behaviors(mood) WHERE deleted_at IS NULL;
  CREATE INDEX behaviors_active_tag
    ON behaviors(tag_id) WHERE deleted_at IS NULL;
  CREATE INDEX star_adjustments_created_at
    ON star_adjustments(created_at DESC);
`;

const SECURE_AUTH_SCHEMA = `
  CREATE TABLE passkeys (
    credential_id TEXT PRIMARY KEY,
    user_slug TEXT NOT NULL CHECK(user_slug IN ('edward', 'lisa')),
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL CHECK(counter >= 0),
    transports_json TEXT NOT NULL,
    device_type TEXT NOT NULL CHECK(device_type IN ('singleDevice', 'multiDevice')),
    backed_up INTEGER NOT NULL CHECK(backed_up IN (0, 1)),
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE INDEX passkeys_user_slug ON passkeys(user_slug, created_at);

  CREATE TABLE webauthn_challenges (
    id TEXT PRIMARY KEY,
    user_slug TEXT NOT NULL CHECK(user_slug IN ('edward', 'lisa')),
    purpose TEXT NOT NULL CHECK(purpose IN ('registration', 'authentication')),
    challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX webauthn_challenges_expires_at
    ON webauthn_challenges(expires_at);

  CREATE TABLE auth_rate_limits (
    bucket_key TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL CHECK(attempt_count >= 1),
    updated_at INTEGER NOT NULL
  );
`;

const GOOGLE_AUTH_SCHEMA = `
  CREATE TABLE google_auth_challenges (
    id TEXT PRIMARY KEY,
    user_slug TEXT NOT NULL CHECK(user_slug IN ('edward', 'lisa')),
    state TEXT NOT NULL UNIQUE CHECK(length(state) BETWEEN 32 AND 256),
    nonce TEXT NOT NULL UNIQUE CHECK(length(nonce) BETWEEN 32 AND 256),
    code_verifier TEXT NOT NULL CHECK(length(code_verifier) BETWEEN 32 AND 256),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX google_auth_challenges_expires_at
    ON google_auth_challenges(expires_at);
`;

const PASSWORD_AUTH_SCHEMA = `
  CREATE TABLE password_credentials (
    user_slug TEXT PRIMARY KEY CHECK(user_slug = 'lisa'),
    password_hash BLOB NOT NULL CHECK(length(password_hash) = 64),
    salt BLOB NOT NULL CHECK(length(salt) = 16),
    algorithm TEXT NOT NULL CHECK(algorithm = 'scrypt'),
    cost_n INTEGER NOT NULL CHECK(cost_n = 32768),
    block_size INTEGER NOT NULL CHECK(block_size = 8),
    parallelization INTEGER NOT NULL CHECK(parallelization = 1),
    key_length INTEGER NOT NULL CHECK(key_length = 64),
    set_by TEXT NOT NULL CHECK(set_by = 'edward'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const SKILLS_SCHEMA = `
  CREATE TABLE skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
    normalized_name TEXT NOT NULL,
    created_by TEXT NOT NULL CHECK(created_by IN ('edward', 'lisa')),
    created_at TEXT NOT NULL,
    completed_by TEXT CHECK(completed_by IN ('edward', 'lisa')),
    completed_at TEXT,
    updated_by TEXT NOT NULL CHECK(updated_by IN ('edward', 'lisa')),
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    deleted_by TEXT CHECK(deleted_by IN ('edward', 'lisa')),
    deleted_at TEXT,
    client_request_id TEXT NOT NULL,
    CHECK (
      (completed_at IS NULL AND completed_by IS NULL) OR
      (completed_at IS NOT NULL AND completed_by IS NOT NULL)
    ),
    CHECK (
      (deleted_at IS NULL AND deleted_by IS NULL) OR
      (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
    ),
    UNIQUE(created_by, client_request_id)
  );

  CREATE UNIQUE INDEX skills_active_normalized_name
    ON skills(normalized_name) WHERE deleted_at IS NULL;
  CREATE INDEX skills_active_completed_at
    ON skills(completed_at)
    WHERE deleted_at IS NULL AND completed_at IS NOT NULL;

  CREATE TABLE skill_create_requests (
    created_by TEXT NOT NULL CHECK(created_by IN ('edward', 'lisa')),
    client_request_id TEXT NOT NULL,
    skill_id TEXT NOT NULL REFERENCES skills(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY(created_by, client_request_id)
  );

  CREATE INDEX skill_create_requests_skill_id
    ON skill_create_requests(skill_id);
`;

interface BehaviorRow {
  id: string;
  mood: Mood;
  occurred_at: string;
  tag_id: string | null;
  tag_name: string | null;
  created_by: UserSlug;
  created_at: string;
  updated_by: UserSlug;
  updated_at: string;
  version: number;
}

interface TagRow {
  id: string;
  name: string;
  usage_count: number;
  created_by: UserSlug;
  created_at: string;
}

interface AdjustmentRow {
  id: string;
  delta: number;
  kind: AdjustmentKind;
  reason: string;
  created_by: UserSlug;
  created_at: string;
}

interface SkillRow {
  id: string;
  name: string;
  normalized_name: string;
  created_by: UserSlug;
  created_at: string;
  completed_by: UserSlug | null;
  completed_at: string | null;
  updated_by: UserSlug;
  updated_at: string;
  version: number;
}

interface ProgressEventRow {
  id: string;
  kind: ProgressEventKind;
  occurred_at: string;
  recorded_at: string;
}

interface SumRow {
  total: number;
}

interface HistoryAdjustmentRow {
  delta: number;
  kind: AdjustmentKind;
  created_at: string;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const isApplied = (version: number) =>
    Boolean(
      db
        .prepare("SELECT 1 AS present FROM schema_migrations WHERE version = ?")
        .get(version),
    );

  const apply = (version: number, sql: string) => {
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(version, new Date().toISOString());
    });
    applyMigration.immediate();
  };

  if (!isApplied(1)) apply(1, INITIAL_SCHEMA);
  if (!isApplied(2)) apply(2, SECURE_AUTH_SCHEMA);
  if (!isApplied(3)) apply(3, GOOGLE_AUTH_SCHEMA);
  if (!isApplied(4)) apply(4, PASSWORD_AUTH_SCHEMA);
  if (!isApplied(5)) apply(5, SKILLS_SCHEMA);
}

export function createDatabase(databasePath: string): Database.Database {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (databasePath !== ":memory:") db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

const globalDatabase = globalThis as typeof globalThis & {
  atlasDatabase?: Database.Database;
};

export function getDatabase(): Database.Database {
  if (!globalDatabase.atlasDatabase) {
    const databasePath = process.env.DATABASE_PATH ?? "./data/atlas.db";
    globalDatabase.atlasDatabase = createDatabase(databasePath);
  }
  return globalDatabase.atlasDatabase;
}

function mapBehavior(row: BehaviorRow): BehaviorEntry {
  return {
    id: row.id,
    mood: row.mood,
    occurredAt: row.occurred_at,
    tag:
      row.tag_id && row.tag_name
        ? { id: row.tag_id, name: row.tag_name }
        : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

const BEHAVIOR_SELECT = `
  SELECT b.id, b.mood, b.occurred_at, b.tag_id, t.name AS tag_name,
         b.created_by, b.created_at, b.updated_by, b.updated_at, b.version
  FROM behaviors b
  LEFT JOIN tags t ON t.id = b.tag_id
`;

const SKILL_SELECT = `
  SELECT s.id, s.name, s.normalized_name, s.created_by, s.created_at,
         s.completed_by, s.completed_at, s.updated_by, s.updated_at, s.version
  FROM skills s
`;

const PROGRESS_EVENT_SELECT = `
  SELECT id, kind, occurred_at, recorded_at
  FROM (
    SELECT b.id AS id,
           CASE b.mood WHEN 'happy' THEN 'happy' ELSE 'tricky' END AS kind,
           b.occurred_at AS occurred_at,
           b.created_at AS recorded_at
    FROM behaviors b
    WHERE b.deleted_at IS NULL

    UNION ALL

    SELECT s.id AS id,
           'skill' AS kind,
           s.completed_at AS occurred_at,
           s.completed_at AS recorded_at
    FROM skills s
    WHERE s.deleted_at IS NULL AND s.completed_at IS NOT NULL
  ) progress_events
`;

function mapSkill(row: SkillRow): SkillEntry {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function findSkillById(
  db: Database.Database,
  id: string,
  includeDeleted = false,
): SkillEntry | null {
  const row = db
    .prepare(
      `${SKILL_SELECT} WHERE s.id = ? ${includeDeleted ? "" : "AND s.deleted_at IS NULL"}`,
    )
    .get(id) as SkillRow | undefined;
  return row ? mapSkill(row) : null;
}

function getOrderedProgressEvents(
  db: Database.Database,
  range?: { from?: string; to?: string },
): ProgressEventRow[] {
  const filters: string[] = [];
  const parameters: string[] = [];
  if (range?.from !== undefined) {
    filters.push("occurred_at >= ?");
    parameters.push(range.from);
  }
  if (range?.to !== undefined) {
    filters.push("occurred_at < ?");
    parameters.push(range.to);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  return db
    .prepare(
      `${PROGRESS_EVENT_SELECT}
       ${where}
       ORDER BY occurred_at ASC, recorded_at ASC,
                CASE kind WHEN 'happy' THEN 0 WHEN 'skill' THEN 1 ELSE 2 END ASC,
                id ASC`,
    )
    .all(...parameters) as ProgressEventRow[];
}

function findBehaviorById(
  db: Database.Database,
  id: string,
  includeDeleted = false,
): BehaviorEntry | null {
  const row = db
    .prepare(
      `${BEHAVIOR_SELECT} WHERE b.id = ? ${includeDeleted ? "" : "AND b.deleted_at IS NULL"}`,
    )
    .get(id) as BehaviorRow | undefined;
  return row ? mapBehavior(row) : null;
}

function getOrCreateTag(
  db: Database.Database,
  requestedName: string | null,
  actor: UserSlug,
  now: string,
): string | null {
  const name = cleanTagName(requestedName);
  if (!name) return null;
  const normalized = normalizeTagName(name);
  const existing = db
    .prepare("SELECT id FROM tags WHERE normalized_name = ?")
    .get(normalized) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO tags (id, name, normalized_name, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, name, normalized, actor, now);
  return id;
}

export function getStarSummary(
  db: Database.Database = getDatabase(),
): StarSummary {
  const progressEvents = getOrderedProgressEvents(db);
  const adjustments = db
    .prepare("SELECT COALESCE(SUM(delta), 0) AS total FROM star_adjustments")
    .get() as SumRow;
  return calculateStarSummary(progressEvents, adjustments.total);
}

export interface CreateBehaviorInput {
  mood: Mood;
  occurredAt: string;
  tag: string | null;
  clientRequestId: string;
}

export function createBehavior(
  input: CreateBehaviorInput,
  actor: UserSlug,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): { behavior: BehaviorEntry; stars: StarSummary; created: boolean } {
  const create = db.transaction(() => {
    const existingRow = db
      .prepare(
        `${BEHAVIOR_SELECT} WHERE b.created_by = ? AND b.client_request_id = ?`,
      )
      .get(actor, input.clientRequestId) as BehaviorRow | undefined;
    if (existingRow) {
      return {
        behavior: mapBehavior(existingRow),
        stars: getStarSummary(db),
        created: false,
      };
    }

    const id = randomUUID();
    const tagId = getOrCreateTag(db, input.tag, actor, now);
    db.prepare(
      `INSERT INTO behaviors
       (id, mood, occurred_at, tag_id, created_by, created_at, updated_by, updated_at,
        version, client_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      id,
      input.mood,
      input.occurredAt,
      tagId,
      actor,
      now,
      actor,
      now,
      input.clientRequestId,
    );

    const behavior = findBehaviorById(db, id);
    if (!behavior) throw new Error("The behavior was not saved.");
    return { behavior, stars: getStarSummary(db), created: true };
  });
  return create.immediate();
}

export interface UpdateBehaviorInput {
  mood: Mood;
  occurredAt: string;
  tag: string | null;
  version: number;
}

export function updateBehavior(
  id: string,
  input: UpdateBehaviorInput,
  actor: UserSlug,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): { behavior: BehaviorEntry; stars: StarSummary } {
  const update = db.transaction(() => {
    const current = findBehaviorById(db, id);
    if (!current)
      throw new AppError(404, "NOT_FOUND", "That behaviour no longer exists.");
    if (current.version !== input.version) {
      throw new AppError(
        409,
        "STALE_ENTRY",
        "This behaviour changed on another phone. Refresh and try again.",
      );
    }

    const tagId = getOrCreateTag(db, input.tag, actor, now);
    const result = db
      .prepare(
        `UPDATE behaviors
         SET mood = ?, occurred_at = ?, tag_id = ?, updated_by = ?, updated_at = ?,
             version = version + 1
         WHERE id = ? AND deleted_at IS NULL AND version = ?`,
      )
      .run(input.mood, input.occurredAt, tagId, actor, now, id, input.version);
    if (result.changes !== 1) {
      throw new AppError(
        409,
        "STALE_ENTRY",
        "This behaviour changed on another phone.",
      );
    }
    const behavior = findBehaviorById(db, id);
    if (!behavior)
      throw new Error("The behaviour could not be read after saving.");
    return { behavior, stars: getStarSummary(db) };
  });
  return update.immediate();
}

export function deleteBehavior(
  id: string,
  version: number,
  actor: UserSlug,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): { stars: StarSummary } {
  const remove = db.transaction(() => {
    const current = findBehaviorById(db, id);
    if (!current)
      throw new AppError(404, "NOT_FOUND", "That behaviour is already gone.");
    if (current.version !== version) {
      throw new AppError(
        409,
        "STALE_ENTRY",
        "This behaviour changed on another phone.",
      );
    }
    const result = db
      .prepare(
        `UPDATE behaviors
         SET deleted_at = ?, deleted_by = ?, updated_at = ?, updated_by = ?,
             version = version + 1
         WHERE id = ? AND deleted_at IS NULL AND version = ?`,
      )
      .run(now, actor, now, actor, id, version);
    if (result.changes !== 1) {
      throw new AppError(
        409,
        "STALE_ENTRY",
        "This behaviour changed on another phone.",
      );
    }
    return { stars: getStarSummary(db) };
  });
  return remove.immediate();
}

export interface CreateSkillInput {
  name: string;
  clientRequestId: string;
}

export function createSkill(
  input: CreateSkillInput,
  actor: UserSlug,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): { skill: SkillEntry; stars: StarSummary; created: boolean } {
  const create = db.transaction(() => {
    const retried = db
      .prepare(
        `${SKILL_SELECT}
         JOIN skill_create_requests request ON request.skill_id = s.id
         WHERE request.created_by = ? AND request.client_request_id = ?`,
      )
      .get(actor, input.clientRequestId) as SkillRow | undefined;
    if (retried) {
      return {
        skill: mapSkill(retried),
        stars: getStarSummary(db),
        created: false,
      };
    }

    const name = cleanSkillName(input.name);
    const normalizedName = normalizeSkillName(name);
    const canonical = db
      .prepare(
        `${SKILL_SELECT}
         WHERE s.normalized_name = ? AND s.deleted_at IS NULL`,
      )
      .get(normalizedName) as SkillRow | undefined;
    if (canonical) {
      db.prepare(
        `INSERT INTO skill_create_requests
         (created_by, client_request_id, skill_id, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(actor, input.clientRequestId, canonical.id, now);
      return {
        skill: mapSkill(canonical),
        stars: getStarSummary(db),
        created: false,
      };
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO skills
       (id, name, normalized_name, created_by, created_at, updated_by,
        updated_at, version, client_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      id,
      name,
      normalizedName,
      actor,
      now,
      actor,
      now,
      input.clientRequestId,
    );
    db.prepare(
      `INSERT INTO skill_create_requests
       (created_by, client_request_id, skill_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(actor, input.clientRequestId, id, now);
    const skill = findSkillById(db, id);
    if (!skill) throw new Error("The skill was not saved.");
    return { skill, stars: getStarSummary(db), created: true };
  });
  return create.immediate();
}

export interface UpdateSkillInput {
  name?: string;
  completed?: boolean;
  version: number;
}

export function updateSkill(
  id: string,
  input: UpdateSkillInput,
  actor: UserSlug,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): { skill: SkillEntry; stars: StarSummary } {
  const update = db.transaction(() => {
    const current = findSkillById(db, id);
    if (!current) {
      throw new AppError(404, "NOT_FOUND", "That skill no longer exists.");
    }

    const nextName =
      input.name === undefined ? current.name : cleanSkillName(input.name);
    const wasCompleted = current.completedAt !== null;
    const nextCompleted = input.completed ?? wasCompleted;
    if (current.version !== input.version) {
      throw new AppError(
        409,
        "STALE_SKILL",
        "This skill changed on another phone. Refresh and try again.",
      );
    }

    const unchanged =
      nextName === current.name && nextCompleted === wasCompleted;
    if (unchanged) return { skill: current, stars: getStarSummary(db) };

    const normalizedName = normalizeSkillName(nextName);
    const duplicate = db
      .prepare(
        `${SKILL_SELECT}
         WHERE s.normalized_name = ? AND s.deleted_at IS NULL AND s.id <> ?`,
      )
      .get(normalizedName, id) as SkillRow | undefined;
    if (duplicate) {
      throw new AppError(
        409,
        "SKILL_EXISTS",
        `“${duplicate.name}” is already in Atlas's skills.`,
      );
    }

    const completedAt =
      nextCompleted === wasCompleted
        ? current.completedAt
        : nextCompleted
          ? now
          : null;
    const completedBy =
      nextCompleted === wasCompleted
        ? current.completedBy
        : nextCompleted
          ? actor
          : null;
    const result = db
      .prepare(
        `UPDATE skills
         SET name = ?, normalized_name = ?, completed_by = ?, completed_at = ?,
             updated_by = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND deleted_at IS NULL AND version = ?`,
      )
      .run(
        nextName,
        normalizedName,
        completedBy,
        completedAt,
        actor,
        now,
        id,
        input.version,
      );
    if (result.changes !== 1) {
      throw new AppError(
        409,
        "STALE_SKILL",
        "This skill changed on another phone. Refresh and try again.",
      );
    }
    const skill = findSkillById(db, id);
    if (!skill) throw new Error("The skill could not be read after saving.");
    return { skill, stars: getStarSummary(db) };
  });
  return update.immediate();
}

export function softDeleteSkill(
  id: string,
  version: number,
  actor: UserSlug,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): { stars: StarSummary } {
  const remove = db.transaction(() => {
    const current = findSkillById(db, id);
    if (!current) {
      throw new AppError(404, "NOT_FOUND", "That skill is already gone.");
    }
    if (current.version !== version) {
      throw new AppError(
        409,
        "STALE_SKILL",
        "This skill changed on another phone. Refresh and try again.",
      );
    }
    const result = db
      .prepare(
        `UPDATE skills
         SET deleted_at = ?, deleted_by = ?, updated_at = ?, updated_by = ?,
             version = version + 1
         WHERE id = ? AND deleted_at IS NULL AND version = ?`,
      )
      .run(now, actor, now, actor, id, version);
    if (result.changes !== 1) {
      throw new AppError(
        409,
        "STALE_SKILL",
        "This skill changed on another phone. Refresh and try again.",
      );
    }
    return { stars: getStarSummary(db) };
  });
  return remove.immediate();
}

export interface CreateStarAdjustmentInput {
  delta: number;
  kind: AdjustmentKind;
  reason: string;
  clientRequestId: string;
}

function mapAdjustment(row: AdjustmentRow): StarAdjustment {
  return {
    id: row.id,
    delta: row.delta,
    kind: row.kind,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function createStarAdjustment(
  input: CreateStarAdjustmentInput,
  actor: UserSlug,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): { adjustment: StarAdjustment; stars: StarSummary; created: boolean } {
  const create = db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT id, delta, kind, reason, created_by, created_at
         FROM star_adjustments WHERE created_by = ? AND client_request_id = ?`,
      )
      .get(actor, input.clientRequestId) as AdjustmentRow | undefined;
    if (existing) {
      return {
        adjustment: mapAdjustment(existing),
        stars: getStarSummary(db),
        created: false,
      };
    }

    const current = getStarSummary(db);
    if (input.kind === "reward" && Math.abs(input.delta) > current.balance) {
      const available = Math.max(0, current.balance);
      throw new AppError(
        409,
        "INSUFFICIENT_STARS",
        `There ${available === 1 ? "is" : "are"} only ${available} star${
          available === 1 ? "" : "s"
        } available.`,
      );
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO star_adjustments
       (id, delta, kind, reason, created_by, created_at, client_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.delta,
      input.kind,
      input.reason,
      actor,
      now,
      input.clientRequestId,
    );
    const row = db
      .prepare(
        `SELECT id, delta, kind, reason, created_by, created_at
         FROM star_adjustments WHERE id = ?`,
      )
      .get(id) as AdjustmentRow;
    return {
      adjustment: mapAdjustment(row),
      stars: getStarSummary(db),
      created: true,
    };
  });
  return create.immediate();
}

export function getDashboard(
  from: string,
  to: string,
  db: Database.Database = getDatabase(),
): DashboardPayload {
  const entries = db
    .prepare(
      `${BEHAVIOR_SELECT}
       WHERE b.deleted_at IS NULL AND b.occurred_at >= ? AND b.occurred_at < ?
       ORDER BY b.occurred_at DESC, b.created_at DESC`,
    )
    .all(from, to) as BehaviorRow[];

  const tags = db
    .prepare(
      `SELECT t.id, t.name, t.created_by, t.created_at, COUNT(b.id) AS usage_count
       FROM tags t
       LEFT JOIN behaviors b ON b.tag_id = t.id AND b.deleted_at IS NULL
       WHERE t.archived_at IS NULL
       GROUP BY t.id
       ORDER BY usage_count DESC, t.name COLLATE NOCASE ASC`,
    )
    .all() as TagRow[];

  const skills = db
    .prepare(
      `${SKILL_SELECT}
       WHERE s.deleted_at IS NULL
       ORDER BY CASE WHEN s.completed_at IS NULL THEN 0 ELSE 1 END ASC,
                s.name COLLATE NOCASE ASC, s.created_at ASC`,
    )
    .all() as SkillRow[];

  const adjustments = db
    .prepare(
      `SELECT id, delta, kind, reason, created_by, created_at
       FROM star_adjustments ORDER BY created_at DESC LIMIT 50`,
    )
    .all() as AdjustmentRow[];

  return {
    entries: entries.map(mapBehavior),
    tags: tags.map((tag): TagSummary => ({
      id: tag.id,
      name: tag.name,
      usageCount: tag.usage_count,
      createdBy: tag.created_by,
      createdAt: tag.created_at,
    })),
    skills: skills.map(mapSkill),
    stars: getStarSummary(db),
    adjustments: adjustments.map(mapAdjustment),
    syncedAt: new Date().toISOString(),
  };
}

export function getHistory(
  from: string,
  to: string,
  db: Database.Database = getDatabase(),
): HistoryPayload {
  const read = db.transaction(() => {
    const progressBefore = getOrderedProgressEvents(db, { to: from });
    const adjustmentsBefore = db
      .prepare(
        `SELECT COALESCE(SUM(delta), 0) AS total FROM star_adjustments
         WHERE created_at < ?`,
      )
      .get(from) as SumRow;
    const progressEvents = getOrderedProgressEvents(db, { from, to });
    const adjustments = db
      .prepare(
        `SELECT delta, kind, created_at FROM star_adjustments
         WHERE created_at >= ? AND created_at < ?
         ORDER BY created_at ASC`,
      )
      .all(from, to) as HistoryAdjustmentRow[];

    return {
      range: { from, to },
      openingStars: calculateStarSummary(
        progressBefore,
        adjustmentsBefore.total,
      ),
      progressEvents: progressEvents.map((event): HistoryProgressFact => ({
        kind: event.kind,
        occurredAt: event.occurred_at,
      })),
      adjustments: adjustments.map((adjustment) => ({
        delta: adjustment.delta,
        kind: adjustment.kind,
        createdAt: adjustment.created_at,
      })),
      syncedAt: new Date().toISOString(),
    } satisfies HistoryPayload;
  });
  return read();
}

export function checkDatabase(db: Database.Database = getDatabase()): boolean {
  const result = db.prepare("SELECT 1 AS ok").get() as { ok: number };
  return result.ok === 1;
}
