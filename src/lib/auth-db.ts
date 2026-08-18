import { randomUUID, timingSafeEqual } from "node:crypto";

import type {
  AuthenticatorTransportFuture,
  CredentialDeviceType,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import type Database from "better-sqlite3";

import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { UserSlug } from "@/lib/types";

export type ChallengePurpose = "registration" | "authentication";

export interface StoredPasskey extends WebAuthnCredential {
  userSlug: UserSlug;
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PasskeyRow {
  credential_id: string;
  user_slug: UserSlug;
  public_key: Buffer;
  counter: number;
  transports_json: string;
  device_type: CredentialDeviceType;
  backed_up: number;
  created_at: string;
  last_used_at: string | null;
}

interface ChallengeRow {
  id: string;
  user_slug: UserSlug;
  purpose: ChallengePurpose;
  challenge: string;
  expires_at: number;
}

interface RateLimitRow {
  window_started_at: number;
  attempt_count: number;
}

interface GoogleAuthChallengeRow {
  id: string;
  user_slug: UserSlug;
  state: string;
  nonce: string;
  code_verifier: string;
  expires_at: number;
}

export interface GoogleAuthChallenge {
  id: string;
  userSlug: UserSlug;
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

export interface StoredPasswordCredential {
  userSlug: "lisa";
  passwordHash: Buffer;
  salt: Buffer;
  algorithm: "scrypt";
  costN: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
  setBy: "edward";
  createdAt: string;
  updatedAt: string;
}

export interface PasswordCredentialInput {
  passwordHash: Buffer;
  salt: Buffer;
  algorithm: "scrypt";
  costN: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
}

interface PasswordCredentialRow {
  user_slug: "lisa";
  password_hash: Buffer;
  salt: Buffer;
  algorithm: "scrypt";
  cost_n: number;
  block_size: number;
  parallelization: number;
  key_length: number;
  set_by: "edward";
  created_at: string;
  updated_at: string;
}

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const GOOGLE_CHALLENGE_LIFETIME_MS = 10 * 60 * 1000;
const MAX_PASSKEYS_PER_USER = 10;

function parseTransports(value: string): AuthenticatorTransportFuture[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (transport): transport is AuthenticatorTransportFuture =>
      typeof transport === "string",
  );
}

function mapPasskey(row: PasskeyRow): StoredPasskey {
  return {
    id: row.credential_id,
    userSlug: row.user_slug,
    publicKey: new Uint8Array(row.public_key),
    counter: row.counter,
    transports: parseTransports(row.transports_json),
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

const PASSKEY_SELECT = `
  SELECT credential_id, user_slug, public_key, counter, transports_json,
         device_type, backed_up, created_at, last_used_at
  FROM passkeys
`;

export function listPasskeys(
  user: UserSlug,
  db: Database.Database = getDatabase(),
): StoredPasskey[] {
  const rows = db
    .prepare(`${PASSKEY_SELECT} WHERE user_slug = ? ORDER BY created_at ASC`)
    .all(user) as PasskeyRow[];
  return rows.map(mapPasskey);
}

export function getPasskey(
  user: UserSlug,
  credentialId: string,
  db: Database.Database = getDatabase(),
): StoredPasskey | null {
  const row = db
    .prepare(`${PASSKEY_SELECT} WHERE user_slug = ? AND credential_id = ?`)
    .get(user, credentialId) as PasskeyRow | undefined;
  return row ? mapPasskey(row) : null;
}

export function getPasskeyCount(
  user: UserSlug,
  db: Database.Database = getDatabase(),
): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM passkeys WHERE user_slug = ?")
    .get(user) as { count: number };
  return row.count;
}

export function savePasskey(
  user: UserSlug,
  credential: WebAuthnCredential,
  deviceType: CredentialDeviceType,
  backedUp: boolean,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): void {
  const save = db.transaction(() => {
    const existing = db
      .prepare("SELECT user_slug FROM passkeys WHERE credential_id = ?")
      .get(credential.id) as { user_slug: UserSlug } | undefined;
    if (existing && existing.user_slug !== user) {
      throw new AppError(
        409,
        "PASSKEY_ALREADY_REGISTERED",
        "That phone unlock is already linked to another Atlas user.",
      );
    }
    if (!existing && getPasskeyCount(user, db) >= MAX_PASSKEYS_PER_USER) {
      throw new AppError(
        409,
        "PASSKEY_LIMIT_REACHED",
        "Remove an old phone unlock before adding another.",
      );
    }

    db.prepare(
      `INSERT INTO passkeys
       (credential_id, user_slug, public_key, counter, transports_json,
        device_type, backed_up, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(credential_id) DO UPDATE SET
         public_key = excluded.public_key,
         counter = excluded.counter,
         transports_json = excluded.transports_json,
         device_type = excluded.device_type,
         backed_up = excluded.backed_up`,
    ).run(
      credential.id,
      user,
      Buffer.from(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      deviceType,
      backedUp ? 1 : 0,
      now,
    );
  });
  save.immediate();
}

export function updatePasskeyCounter(
  user: UserSlug,
  credentialId: string,
  expectedCounter: number,
  counter: number,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): void {
  const update = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE passkeys SET counter = ?, last_used_at = ?
         WHERE user_slug = ? AND credential_id = ? AND counter = ?`,
      )
      .run(counter, now, user, credentialId, expectedCounter);
    if (result.changes === 1) return;

    const exists = db
      .prepare(
        "SELECT 1 AS present FROM passkeys WHERE user_slug = ? AND credential_id = ?",
      )
      .get(user, credentialId);
    if (!exists) {
      throw new AppError(
        401,
        "PASSKEY_NOT_FOUND",
        "That phone unlock is no longer registered.",
      );
    }
    throw new AppError(
      401,
      "PASSKEY_COUNTER_STALE",
      "That phone unlock was already used. Please try again.",
    );
  });
  update.immediate();
}

export function getLisaPasswordCredential(
  db: Database.Database = getDatabase(),
): StoredPasswordCredential | null {
  const row = db
    .prepare(
      `SELECT user_slug, password_hash, salt, algorithm, cost_n, block_size,
              parallelization, key_length, set_by, created_at, updated_at
       FROM password_credentials WHERE user_slug = 'lisa'`,
    )
    .get() as PasswordCredentialRow | undefined;
  if (!row) return null;
  return {
    userSlug: row.user_slug,
    passwordHash: Buffer.from(row.password_hash),
    salt: Buffer.from(row.salt),
    algorithm: row.algorithm,
    costN: row.cost_n,
    blockSize: row.block_size,
    parallelization: row.parallelization,
    keyLength: row.key_length,
    setBy: row.set_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getLisaPasswordStatus(db: Database.Database = getDatabase()): {
  configured: boolean;
  updatedAt: string | null;
} {
  const credential = getLisaPasswordCredential(db);
  return {
    configured: credential !== null,
    updatedAt: credential?.updatedAt ?? null,
  };
}

export function saveLisaPasswordCredential(
  input: PasswordCredentialInput,
  actor: UserSlug,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): { configured: true; updatedAt: string } {
  if (actor !== "edward") {
    throw new AppError(
      403,
      "EDWARD_REQUIRED",
      "Only Edward can manage Lisa's password.",
    );
  }
  const save = db.transaction(() => {
    db.prepare(
      `INSERT INTO password_credentials
         (user_slug, password_hash, salt, algorithm, cost_n, block_size,
          parallelization, key_length, set_by, created_at, updated_at)
       VALUES ('lisa', ?, ?, ?, ?, ?, ?, ?, 'edward', ?, ?)
       ON CONFLICT(user_slug) DO UPDATE SET
         password_hash = excluded.password_hash,
         salt = excluded.salt,
         algorithm = excluded.algorithm,
         cost_n = excluded.cost_n,
         block_size = excluded.block_size,
         parallelization = excluded.parallelization,
         key_length = excluded.key_length,
         set_by = excluded.set_by,
         updated_at = excluded.updated_at`,
    ).run(
      input.passwordHash,
      input.salt,
      input.algorithm,
      input.costN,
      input.blockSize,
      input.parallelization,
      input.keyLength,
      now,
      now,
    );
    clearLisaPasswordAttempts(db);
  });
  save.immediate();
  return { configured: true, updatedAt: now };
}

export function createWebAuthnChallenge(
  user: UserSlug,
  purpose: ChallengePurpose,
  challenge: string,
  db: Database.Database = getDatabase(),
  now = Date.now(),
): string {
  const id = randomUUID();
  const create = db.transaction(() => {
    db.prepare("DELETE FROM webauthn_challenges WHERE expires_at <= ?").run(
      now,
    );
    db.prepare(
      `INSERT INTO webauthn_challenges
       (id, user_slug, purpose, challenge, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, user, purpose, challenge, now + CHALLENGE_LIFETIME_MS, now);
  });
  create.immediate();
  return id;
}

export function consumeWebAuthnChallenge(
  id: string | undefined,
  user: UserSlug,
  purpose: ChallengePurpose,
  db: Database.Database = getDatabase(),
  now = Date.now(),
): string {
  if (!id) {
    throw new AppError(
      400,
      "PASSKEY_CHALLENGE_MISSING",
      "Start the phone-unlock step again.",
    );
  }

  const consume = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id, user_slug, purpose, challenge, expires_at
         FROM webauthn_challenges WHERE id = ?`,
      )
      .get(id) as ChallengeRow | undefined;
    db.prepare("DELETE FROM webauthn_challenges WHERE id = ?").run(id);

    if (
      !row ||
      row.user_slug !== user ||
      row.purpose !== purpose ||
      row.expires_at <= now
    ) {
      throw new AppError(
        400,
        "PASSKEY_CHALLENGE_EXPIRED",
        "That phone-unlock request expired. Please try again.",
      );
    }
    return row.challenge;
  });
  return consume.immediate();
}

export function createGoogleAuthChallenge(
  user: UserSlug,
  values: { state: string; nonce: string; codeVerifier: string },
  db: Database.Database = getDatabase(),
  now = Date.now(),
): GoogleAuthChallenge {
  const challenge: GoogleAuthChallenge = {
    id: randomUUID(),
    userSlug: user,
    state: values.state,
    nonce: values.nonce,
    codeVerifier: values.codeVerifier,
    expiresAt: now + GOOGLE_CHALLENGE_LIFETIME_MS,
  };
  const create = db.transaction(() => {
    db.prepare("DELETE FROM google_auth_challenges WHERE expires_at <= ?").run(
      now,
    );
    db.prepare(
      `INSERT INTO google_auth_challenges
       (id, user_slug, state, nonce, code_verifier, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      challenge.id,
      challenge.userSlug,
      challenge.state,
      challenge.nonce,
      challenge.codeVerifier,
      challenge.expiresAt,
      now,
    );
  });
  create.immediate();
  return challenge;
}

function sameSecret(left: string, right: string | undefined): boolean {
  if (!right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isBoundedOidcSecret(value: string | undefined): value is string {
  return Boolean(
    value &&
    value.length >= 32 &&
    value.length <= 256 &&
    /^[A-Za-z0-9_-]+$/.test(value),
  );
}

export function consumeGoogleAuthChallenge(
  id: string | undefined,
  returnedState: string | undefined,
  db: Database.Database = getDatabase(),
  now = Date.now(),
): GoogleAuthChallenge {
  if (!id || id.length > 64) {
    throw new AppError(
      400,
      "GOOGLE_LOGIN_EXPIRED",
      "That Google sign-in expired. Please start again.",
    );
  }

  const consume = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id, user_slug, state, nonce, code_verifier, expires_at
         FROM google_auth_challenges WHERE id = ?`,
      )
      .get(id) as GoogleAuthChallengeRow | undefined;
    db.prepare("DELETE FROM google_auth_challenges WHERE id = ?").run(id);

    if (
      !row ||
      row.expires_at <= now ||
      !isBoundedOidcSecret(returnedState) ||
      !sameSecret(row.state, returnedState)
    ) {
      throw new AppError(
        400,
        "GOOGLE_LOGIN_EXPIRED",
        "That Google sign-in expired. Please start again.",
      );
    }

    return {
      id: row.id,
      userSlug: row.user_slug,
      state: row.state,
      nonce: row.nonce,
      codeVerifier: row.code_verifier,
      expiresAt: row.expires_at,
    } satisfies GoogleAuthChallenge;
  });
  return consume.immediate();
}

function consumeBucket(
  db: Database.Database,
  bucketKey: string,
  limit: number,
  windowMs: number,
  now: number,
): void {
  const row = db
    .prepare(
      `SELECT window_started_at, attempt_count
       FROM auth_rate_limits WHERE bucket_key = ?`,
    )
    .get(bucketKey) as RateLimitRow | undefined;

  if (!row || now - row.window_started_at >= windowMs) {
    db.prepare(
      `INSERT INTO auth_rate_limits
       (bucket_key, window_started_at, attempt_count, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET
         window_started_at = excluded.window_started_at,
         attempt_count = 1,
         updated_at = excluded.updated_at`,
    ).run(bucketKey, now, now);
    return;
  }

  if (row.attempt_count >= limit) {
    throw new AppError(
      429,
      "TOO_MANY_ATTEMPTS",
      "Too many sign-in attempts. Please wait and try again.",
    );
  }

  db.prepare(
    `UPDATE auth_rate_limits
     SET attempt_count = attempt_count + 1, updated_at = ?
     WHERE bucket_key = ?`,
  ).run(now, bucketKey);
}

export function assertGoogleStartAllowed(
  user: UserSlug,
  db: Database.Database = getDatabase(),
  now = Date.now(),
): void {
  const consume = db.transaction(() => {
    consumeBucket(db, `google-start:${user}`, 10, 10 * 60 * 1000, now);
  });
  consume.immediate();
}

export function assertGoogleCallbackAllowed(
  user: UserSlug,
  db: Database.Database = getDatabase(),
  now = Date.now(),
): void {
  const consume = db.transaction(() => {
    consumeBucket(db, `google-callback:${user}`, 10, 10 * 60 * 1000, now);
  });
  consume.immediate();
}

export function assertPasskeyAttemptAllowed(
  user: UserSlug,
  db: Database.Database = getDatabase(),
  now = Date.now(),
): void {
  const consume = db.transaction(() => {
    consumeBucket(db, `passkey-attempt:${user}`, 30, 10 * 60 * 1000, now);
  });
  consume.immediate();
}

export function assertLisaPasswordAttemptAllowed(
  db: Database.Database = getDatabase(),
  now = Date.now(),
): void {
  const consume = db.transaction(() => {
    consumeBucket(db, "password-login:lisa", 10, 15 * 60 * 1000, now);
  });
  consume.immediate();
}

export function clearLisaPasswordAttempts(
  db: Database.Database = getDatabase(),
): void {
  db.prepare("DELETE FROM auth_rate_limits WHERE bucket_key = ?").run(
    "password-login:lisa",
  );
}
