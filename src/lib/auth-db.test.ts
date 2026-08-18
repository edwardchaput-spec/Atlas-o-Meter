import type { WebAuthnCredential } from "@simplewebauthn/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertGoogleCallbackAllowed,
  assertGoogleStartAllowed,
  assertLisaPasswordAttemptAllowed,
  assertPasskeyAttemptAllowed,
  clearLisaPasswordAttempts,
  consumeGoogleAuthChallenge,
  consumeWebAuthnChallenge,
  createGoogleAuthChallenge,
  createWebAuthnChallenge,
  getLisaPasswordCredential,
  getLisaPasswordStatus,
  getPasskey,
  getPasskeyCount,
  listPasskeys,
  saveLisaPasswordCredential,
  savePasskey,
  updatePasskeyCounter,
} from "@/lib/auth-db";
import { createDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";

describe("passkey repository", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function expectAppError(
    action: () => unknown,
    status: number,
    code: string,
  ): void {
    expect(action).toThrowError(
      expect.objectContaining<Partial<AppError>>({ status, code }),
    );
  }

  it("persists credential bytes, metadata, counters, and last-used audit data", () => {
    savePasskey(
      "edward",
      {
        id: "credential-one",
        publicKey: new Uint8Array([0, 1, 127, 255]),
        counter: 7,
        transports: ["internal", "hybrid"],
      },
      "multiDevice",
      true,
      db,
      "2026-08-09T10:00:00.000Z",
    );

    expect(getPasskeyCount("edward", db)).toBe(1);
    expect(getPasskeyCount("lisa", db)).toBe(0);
    expect(listPasskeys("lisa", db)).toEqual([]);
    expect(getPasskey("edward", "credential-one", db)).toMatchObject({
      id: "credential-one",
      userSlug: "edward",
      publicKey: new Uint8Array([0, 1, 127, 255]),
      counter: 7,
      transports: ["internal", "hybrid"],
      deviceType: "multiDevice",
      backedUp: true,
      createdAt: "2026-08-09T10:00:00.000Z",
      lastUsedAt: null,
    });

    updatePasskeyCounter(
      "edward",
      "credential-one",
      7,
      8,
      db,
      "2026-08-09T10:05:00.000Z",
    );
    expect(getPasskey("edward", "credential-one", db)).toMatchObject({
      counter: 8,
      lastUsedAt: "2026-08-09T10:05:00.000Z",
    });
    expectAppError(
      () => updatePasskeyCounter("lisa", "credential-one", 8, 9, db),
      401,
      "PASSKEY_NOT_FOUND",
    );
  });

  it("rejects a stale nonzero counter update without regressing the stored counter", () => {
    savePasskey(
      "lisa",
      {
        id: "concurrent-credential",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 7,
        transports: ["internal"],
      },
      "singleDevice",
      false,
      db,
    );

    updatePasskeyCounter(
      "lisa",
      "concurrent-credential",
      7,
      8,
      db,
      "2026-08-09T10:05:00.000Z",
    );
    expectAppError(
      () =>
        updatePasskeyCounter(
          "lisa",
          "concurrent-credential",
          7,
          8,
          db,
          "2026-08-09T10:06:00.000Z",
        ),
      401,
      "PASSKEY_COUNTER_STALE",
    );
    expect(getPasskey("lisa", "concurrent-credential", db)).toMatchObject({
      counter: 8,
      lastUsedAt: "2026-08-09T10:05:00.000Z",
    });
  });

  it("allows authenticators that intentionally keep a zero signature counter", () => {
    savePasskey(
      "lisa",
      {
        id: "zero-counter-credential",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"],
      },
      "multiDevice",
      true,
      db,
    );

    updatePasskeyCounter(
      "lisa",
      "zero-counter-credential",
      0,
      0,
      db,
      "2026-08-09T10:05:00.000Z",
    );
    updatePasskeyCounter(
      "lisa",
      "zero-counter-credential",
      0,
      0,
      db,
      "2026-08-09T10:06:00.000Z",
    );
    expect(getPasskey("lisa", "zero-counter-credential", db)).toMatchObject({
      counter: 0,
      lastUsedAt: "2026-08-09T10:06:00.000Z",
    });
  });

  it("keeps credentials scoped to one user and enforces the per-user limit", () => {
    const credential = (id: string): WebAuthnCredential => ({
      id,
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
      transports: ["internal"],
    });

    savePasskey(
      "edward",
      credential("shared-credential"),
      "singleDevice",
      false,
      db,
    );
    expectAppError(
      () =>
        savePasskey(
          "lisa",
          credential("shared-credential"),
          "singleDevice",
          false,
          db,
        ),
      409,
      "PASSKEY_ALREADY_REGISTERED",
    );

    for (let index = 1; index < 10; index += 1) {
      savePasskey(
        "edward",
        credential(`edward-${index}`),
        "singleDevice",
        false,
        db,
      );
    }
    expect(getPasskeyCount("edward", db)).toBe(10);
    expectAppError(
      () =>
        savePasskey(
          "edward",
          credential("one-too-many"),
          "singleDevice",
          false,
          db,
        ),
      409,
      "PASSKEY_LIMIT_REACHED",
    );

    savePasskey("lisa", credential("lisa-first"), "singleDevice", false, db);
    expect(getPasskeyCount("lisa", db)).toBe(1);
  });
});

describe("Lisa password credential repository", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  const credential = (marker: number) => ({
    passwordHash: Buffer.alloc(64, marker),
    salt: Buffer.alloc(16, marker),
    algorithm: "scrypt" as const,
    costN: 32_768,
    blockSize: 8,
    parallelization: 1,
    keyLength: 64,
  });

  it("stores only Lisa's binary credential and preserves creation audit on replacement", () => {
    expect(getLisaPasswordStatus(db)).toEqual({
      configured: false,
      updatedAt: null,
    });

    expect(
      saveLisaPasswordCredential(
        credential(1),
        "edward",
        db,
        "2026-08-10T10:00:00.000Z",
      ),
    ).toEqual({
      configured: true,
      updatedAt: "2026-08-10T10:00:00.000Z",
    });
    expect(getLisaPasswordCredential(db)).toMatchObject({
      userSlug: "lisa",
      passwordHash: Buffer.alloc(64, 1),
      salt: Buffer.alloc(16, 1),
      algorithm: "scrypt",
      costN: 32_768,
      blockSize: 8,
      parallelization: 1,
      keyLength: 64,
      setBy: "edward",
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-10T10:00:00.000Z",
    });

    saveLisaPasswordCredential(
      credential(2),
      "edward",
      db,
      "2026-08-10T11:00:00.000Z",
    );
    expect(getLisaPasswordCredential(db)).toMatchObject({
      passwordHash: Buffer.alloc(64, 2),
      salt: Buffer.alloc(16, 2),
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-10T11:00:00.000Z",
    });
  });

  it("refuses to let Lisa write the credential even at the repository boundary", () => {
    expect(() =>
      saveLisaPasswordCredential(credential(1), "lisa", db),
    ).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        status: 403,
        code: "EDWARD_REQUIRED",
      }),
    );
    expect(getLisaPasswordCredential(db)).toBeNull();
  });

  it("atomically clears Lisa's password-attempt bucket when Edward saves a credential", () => {
    const now = Date.UTC(2026, 7, 10, 10);
    assertLisaPasswordAttemptAllowed(db, now);

    saveLisaPasswordCredential(
      credential(1),
      "edward",
      db,
      "2026-08-10T10:00:00.000Z",
    );
    expect(
      db
        .prepare(
          "SELECT 1 FROM auth_rate_limits WHERE bucket_key = 'password-login:lisa'",
        )
        .get(),
    ).toBeUndefined();

    assertLisaPasswordAttemptAllowed(db, now + 1);
    expect(() =>
      saveLisaPasswordCredential(
        { ...credential(2), passwordHash: Buffer.alloc(63, 2) },
        "edward",
        db,
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(
      db
        .prepare(
          "SELECT attempt_count FROM auth_rate_limits WHERE bucket_key = 'password-login:lisa'",
        )
        .get(),
    ).toEqual({ attempt_count: 1 });
  });
});

describe("WebAuthn challenge repository", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function expectChallengeError(action: () => unknown): void {
    expect(action).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        status: 400,
        code: "PASSKEY_CHALLENGE_EXPIRED",
      }),
    );
  }

  it("returns a valid challenge exactly once", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    const id = createWebAuthnChallenge(
      "edward",
      "authentication",
      "server-challenge",
      db,
      now,
    );

    expect(
      consumeWebAuthnChallenge(id, "edward", "authentication", db, now + 1),
    ).toBe("server-challenge");
    expectChallengeError(() =>
      consumeWebAuthnChallenge(id, "edward", "authentication", db, now + 2),
    );
  });

  it("rejects missing, expired, cross-user, and wrong-purpose challenges", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    expect(() =>
      consumeWebAuthnChallenge(undefined, "edward", "authentication", db, now),
    ).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        status: 400,
        code: "PASSKEY_CHALLENGE_MISSING",
      }),
    );

    const crossUserId = createWebAuthnChallenge(
      "edward",
      "authentication",
      "private-to-edward",
      db,
      now,
    );
    expectChallengeError(() =>
      consumeWebAuthnChallenge(
        crossUserId,
        "lisa",
        "authentication",
        db,
        now + 1,
      ),
    );

    const registrationId = createWebAuthnChallenge(
      "lisa",
      "registration",
      "registration-only",
      db,
      now,
    );
    expectChallengeError(() =>
      consumeWebAuthnChallenge(
        registrationId,
        "lisa",
        "authentication",
        db,
        now + 1,
      ),
    );

    const expiredId = createWebAuthnChallenge(
      "lisa",
      "authentication",
      "expires-at-five-minutes",
      db,
      now,
    );
    expectChallengeError(() =>
      consumeWebAuthnChallenge(
        expiredId,
        "lisa",
        "authentication",
        db,
        now + 5 * 60 * 1000,
      ),
    );
  });

  it("purges expired challenges while creating a fresh one", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    createWebAuthnChallenge("edward", "registration", "old-challenge", db, now);
    const freshId = createWebAuthnChallenge(
      "lisa",
      "authentication",
      "fresh-challenge",
      db,
      now + 5 * 60 * 1000,
    );

    expect(
      db
        .prepare("SELECT id FROM webauthn_challenges ORDER BY created_at")
        .all(),
    ).toEqual([{ id: freshId }]);
  });
});

describe("Google authentication challenge repository", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function createChallenge(now: number) {
    return createGoogleAuthChallenge(
      "edward",
      {
        state: "s".repeat(43),
        nonce: "n".repeat(43),
        codeVerifier: "v".repeat(64),
      },
      db,
      now,
    );
  }

  function expectGoogleChallengeError(action: () => unknown): void {
    expect(action).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        status: 400,
        code: "GOOGLE_LOGIN_EXPIRED",
      }),
    );
  }

  it("binds the selected actor, state, nonce and PKCE verifier and consumes them once", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    const challenge = createChallenge(now);

    expect(
      consumeGoogleAuthChallenge(challenge.id, challenge.state, db, now + 1),
    ).toEqual(challenge);
    expectGoogleChallengeError(() =>
      consumeGoogleAuthChallenge(challenge.id, challenge.state, db, now + 2),
    );
  });

  it("rejects missing, mismatched and expired transactions without letting a state be reused", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    expectGoogleChallengeError(() =>
      consumeGoogleAuthChallenge(undefined, "s".repeat(43), db, now),
    );

    const mismatched = createChallenge(now);
    expectGoogleChallengeError(() =>
      consumeGoogleAuthChallenge(mismatched.id, "x".repeat(43), db, now + 1),
    );
    expect(
      consumeGoogleAuthChallenge(mismatched.id, mismatched.state, db, now + 2),
    ).toEqual(mismatched);
    expectGoogleChallengeError(() =>
      consumeGoogleAuthChallenge(mismatched.id, mismatched.state, db, now + 3),
    );

    const expired = createChallenge(now);
    expectGoogleChallengeError(() =>
      consumeGoogleAuthChallenge(
        expired.id,
        expired.state,
        db,
        now + 10 * 60 * 1000,
      ),
    );
  });

  it("purges expired Google transactions without touching a fresh one", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    createChallenge(now);
    const fresh = createGoogleAuthChallenge(
      "lisa",
      {
        state: "a".repeat(43),
        nonce: "b".repeat(43),
        codeVerifier: "c".repeat(64),
      },
      db,
      now + 10 * 60 * 1000,
    );

    expect(db.prepare("SELECT id FROM google_auth_challenges").all()).toEqual([
      { id: fresh.id },
    ]);
  });

  it("does not allow state or nonce values to be shared by two ceremonies", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    const first = createChallenge(now);

    expect(() =>
      createGoogleAuthChallenge(
        "lisa",
        {
          state: "z".repeat(43),
          nonce: first.nonce,
          codeVerifier: "c".repeat(64),
        },
        db,
        now + 1,
      ),
    ).toThrow(/UNIQUE constraint failed: google_auth_challenges\.nonce/);
    expect(() =>
      createGoogleAuthChallenge(
        "lisa",
        {
          state: first.state,
          nonce: "q".repeat(43),
          codeVerifier: "d".repeat(64),
        },
        db,
        now + 2,
      ),
    ).toThrow(/UNIQUE constraint failed: google_auth_challenges\.state/);
  });
});

describe("authentication rate limits", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function expectRateLimited(action: () => unknown): void {
    expect(action).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        status: 429,
        code: "TOO_MANY_ATTEMPTS",
      }),
    );
  }

  it("caps Google sign-in starts at ten per ten minutes per actor", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assertGoogleStartAllowed("edward", db, now + attempt);
    }
    expectRateLimited(() => assertGoogleStartAllowed("edward", db, now + 10));

    expect(() => assertGoogleStartAllowed("lisa", db, now + 10)).not.toThrow();
    expect(() =>
      assertGoogleStartAllowed("edward", db, now + 10 * 60 * 1000),
    ).not.toThrow();
  });

  it("caps Google callback attempts at ten per ten minutes per actor", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assertGoogleCallbackAllowed("lisa", db, now + attempt);
    }
    expectRateLimited(() => assertGoogleCallbackAllowed("lisa", db, now + 10));
    expect(() =>
      assertGoogleCallbackAllowed("lisa", db, now + 10 * 60 * 1000),
    ).not.toThrow();
  });

  it("caps passkey attempts at thirty per ten minutes", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      assertPasskeyAttemptAllowed("edward", db, now + attempt);
    }
    expectRateLimited(() =>
      assertPasskeyAttemptAllowed("edward", db, now + 30),
    );
    expect(() =>
      assertPasskeyAttemptAllowed("edward", db, now + 10 * 60 * 1000),
    ).not.toThrow();
  });

  it("caps Lisa password attempts at ten per fifteen minutes and clears on success", () => {
    const now = Date.UTC(2026, 7, 9, 10);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assertLisaPasswordAttemptAllowed(db, now + attempt);
    }
    expectRateLimited(() => assertLisaPasswordAttemptAllowed(db, now + 10));

    clearLisaPasswordAttempts(db);
    expect(() => assertLisaPasswordAttemptAllowed(db, now + 11)).not.toThrow();
    expect(() =>
      assertLisaPasswordAttemptAllowed(db, now + 15 * 60 * 1000),
    ).not.toThrow();
  });
});
