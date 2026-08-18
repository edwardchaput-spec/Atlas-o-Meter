import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "@/lib/db";

describe("additive database migrations", () => {
  let temporaryDirectory: string | undefined;

  afterEach(() => {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it("adds authentication and skill migrations without replacing existing data", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "atlas-migration-test-"));
    const databasePath = join(temporaryDirectory, "atlas-v2.db");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (1, '2026-01-01T00:00:00.000Z'),
             (2, '2026-01-02T00:00:00.000Z');

      CREATE TABLE behaviors (
        id TEXT PRIMARY KEY,
        mood TEXT NOT NULL
      );
      INSERT INTO behaviors (id, mood) VALUES ('existing-behavior', 'happy');

      CREATE TABLE passkeys (
        credential_id TEXT PRIMARY KEY,
        user_slug TEXT NOT NULL
      );
      INSERT INTO passkeys (credential_id, user_slug)
      VALUES ('existing-passkey', 'edward');

      CREATE TABLE auth_rate_limits (
        bucket_key TEXT PRIMARY KEY,
        window_started_at INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO auth_rate_limits
        (bucket_key, window_started_at, attempt_count, updated_at)
      VALUES ('sms-hour:edward', 1, 2, 3);
    `);
    legacy.close();

    const migrated = createDatabase(databasePath);
    expect(
      migrated
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
    ]);
    expect(migrated.prepare("SELECT * FROM behaviors").all()).toEqual([
      { id: "existing-behavior", mood: "happy" },
    ]);
    expect(migrated.prepare("SELECT * FROM passkeys").all()).toEqual([
      { credential_id: "existing-passkey", user_slug: "edward" },
    ]);
    expect(migrated.prepare("SELECT * FROM auth_rate_limits").all()).toEqual([
      {
        bucket_key: "sms-hour:edward",
        window_started_at: 1,
        attempt_count: 2,
        updated_at: 3,
      },
    ]);
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'google_auth_challenges'",
        )
        .get(),
    ).toEqual({ name: "google_auth_challenges" });
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'password_credentials'",
        )
        .get(),
    ).toEqual({ name: "password_credentials" });

    const validCredential = {
      hash: Buffer.alloc(64, 1),
      salt: Buffer.alloc(16, 2),
    };
    migrated
      .prepare(
        `INSERT INTO password_credentials
           (user_slug, password_hash, salt, algorithm, cost_n, block_size,
            parallelization, key_length, set_by, created_at, updated_at)
         VALUES ('lisa', ?, ?, 'scrypt', 32768, 8, 1, 64, 'edward', ?, ?)`,
      )
      .run(
        validCredential.hash,
        validCredential.salt,
        "2026-08-10T10:00:00.000Z",
        "2026-08-10T10:00:00.000Z",
      );
    expect(
      migrated
        .prepare(
          "SELECT user_slug, length(password_hash) AS hash_length, length(salt) AS salt_length, algorithm, cost_n, block_size, parallelization, key_length, set_by FROM password_credentials",
        )
        .get(),
    ).toEqual({
      user_slug: "lisa",
      hash_length: 64,
      salt_length: 16,
      algorithm: "scrypt",
      cost_n: 32_768,
      block_size: 8,
      parallelization: 1,
      key_length: 64,
      set_by: "edward",
    });

    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('skills', 'skill_create_requests') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: "skill_create_requests" }, { name: "skills" }]);

    migrated
      .prepare(
        `INSERT INTO skills
          (id, name, normalized_name, created_by, created_at, updated_by,
           updated_at, version, client_request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        "skill-one",
        "Tying his shoelaces",
        "tying his shoelaces",
        "lisa",
        "2026-08-10T12:00:00.000Z",
        "lisa",
        "2026-08-10T12:00:00.000Z",
        "request-one",
      );
    migrated
      .prepare(
        `INSERT INTO skill_create_requests
          (created_by, client_request_id, skill_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        "edward",
        "canonical-request",
        "skill-one",
        "2026-08-10T12:01:00.000Z",
      );

    expect(() =>
      migrated
        .prepare(
          `INSERT INTO skills
            (id, name, normalized_name, created_by, created_at, completed_at,
             updated_by, updated_at, version, client_request_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          "invalid-completion",
          "Riding a bike",
          "riding a bike",
          "edward",
          "2026-08-10T12:02:00.000Z",
          "2026-08-10T12:02:00.000Z",
          "edward",
          "2026-08-10T12:02:00.000Z",
          "invalid-request",
        ),
    ).toThrow();
    expect(() =>
      migrated
        .prepare(
          `INSERT INTO skills
            (id, name, normalized_name, created_by, created_at, updated_by,
             updated_at, version, client_request_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          "active-duplicate",
          "TYING HIS SHOELACES",
          "tying his shoelaces",
          "edward",
          "2026-08-10T12:03:00.000Z",
          "edward",
          "2026-08-10T12:03:00.000Z",
          "duplicate-request",
        ),
    ).toThrow();

    migrated
      .prepare(
        `UPDATE skills
         SET deleted_by = 'edward', deleted_at = ?, updated_by = 'edward',
             updated_at = ?, version = version + 1
         WHERE id = 'skill-one'`,
      )
      .run("2026-08-10T12:04:00.000Z", "2026-08-10T12:04:00.000Z");
    expect(() =>
      migrated
        .prepare(
          `INSERT INTO skills
            (id, name, normalized_name, created_by, created_at, updated_by,
             updated_at, version, client_request_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          "recreated-skill",
          "Tying his shoelaces",
          "tying his shoelaces",
          "edward",
          "2026-08-10T12:05:00.000Z",
          "edward",
          "2026-08-10T12:05:00.000Z",
          "recreated-request",
        ),
    ).not.toThrow();
    migrated.close();
  });
});
