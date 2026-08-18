import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getLisaPasswordCredential,
  saveLisaPasswordCredential,
} from "@/lib/auth-db";
import { createDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  authenticateLisaPassword,
  PASSWORD_SCRYPT_PARAMETERS,
  replaceLisaPassword,
} from "@/lib/password-auth";

describe("Lisa password authentication", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("stores the agreed scrypt parameters and verifies the exact untrimmed password", async () => {
    const password = "  correct horse battery  ";
    await expect(
      replaceLisaPassword(password, "edward", db, "2026-08-10T10:00:00.000Z"),
    ).resolves.toEqual({
      configured: true,
      updatedAt: "2026-08-10T10:00:00.000Z",
    });

    expect(getLisaPasswordCredential(db)).toMatchObject({
      algorithm: PASSWORD_SCRYPT_PARAMETERS.algorithm,
      costN: PASSWORD_SCRYPT_PARAMETERS.costN,
      blockSize: PASSWORD_SCRYPT_PARAMETERS.blockSize,
      parallelization: PASSWORD_SCRYPT_PARAMETERS.parallelization,
      keyLength: PASSWORD_SCRYPT_PARAMETERS.keyLength,
      setBy: "edward",
    });
    expect(getLisaPasswordCredential(db)?.salt).toHaveLength(16);
    expect(getLisaPasswordCredential(db)?.passwordHash).toHaveLength(64);

    await expect(
      authenticateLisaPassword(password.trim(), db),
    ).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
    await expect(
      authenticateLisaPassword(password, db),
    ).resolves.toBeUndefined();
    expect(
      db
        .prepare(
          "SELECT 1 FROM auth_rate_limits WHERE bucket_key = 'password-login:lisa'",
        )
        .get(),
    ).toBeUndefined();
  });

  it("uses the same safe failure for a missing credential and a wrong password", async () => {
    const captureFailure = async (): Promise<Partial<AppError>> => {
      try {
        await authenticateLisaPassword("wrong but bounded", db);
        throw new Error("Expected authentication to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        return {
          status: appError.status,
          code: appError.code,
          message: appError.message,
        };
      }
    };

    const missingFailure = await captureFailure();
    await replaceLisaPassword("the configured password", "edward", db);
    const wrongFailure = await captureFailure();
    expect(wrongFailure).toEqual(missingFailure);
  });

  it("uses a fresh random salt on replacement and accepts only the new password", async () => {
    await replaceLisaPassword("first family passphrase", "edward", db);
    const firstSalt = getLisaPasswordCredential(db)?.salt;

    await replaceLisaPassword("second family passphrase", "edward", db);
    const secondSalt = getLisaPasswordCredential(db)?.salt;
    expect(firstSalt).toHaveLength(16);
    expect(secondSalt).toHaveLength(16);
    expect(secondSalt).not.toEqual(firstSalt);

    await expect(
      authenticateLisaPassword("first family passphrase", db),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(
      authenticateLisaPassword("second family passphrase", db),
    ).resolves.toBeUndefined();
  });

  it("rejects an otherwise valid password if Edward changes the credential during scrypt", async () => {
    const password = "original family passphrase";
    await replaceLisaPassword(
      password,
      "edward",
      db,
      "2026-08-10T10:00:00.000Z",
    );

    const authentication = authenticateLisaPassword(password, db);
    saveLisaPasswordCredential(
      {
        passwordHash: Buffer.alloc(PASSWORD_SCRYPT_PARAMETERS.keyLength, 1),
        salt: Buffer.alloc(PASSWORD_SCRYPT_PARAMETERS.saltLength, 2),
        algorithm: PASSWORD_SCRYPT_PARAMETERS.algorithm,
        costN: PASSWORD_SCRYPT_PARAMETERS.costN,
        blockSize: PASSWORD_SCRYPT_PARAMETERS.blockSize,
        parallelization: PASSWORD_SCRYPT_PARAMETERS.parallelization,
        keyLength: PASSWORD_SCRYPT_PARAMETERS.keyLength,
      },
      "edward",
      db,
      "2026-08-10T10:01:00.000Z",
    );

    await expect(authentication).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "That password could not be verified.",
    });
  });

  it("rejects unsupported stored work factors without deriving with them", async () => {
    await replaceLisaPassword("the configured password", "edward", db);
    db.pragma("ignore_check_constraints = ON");
    db.prepare(
      "UPDATE password_credentials SET cost_n = 2147483647 WHERE user_slug = 'lisa'",
    ).run();
    db.pragma("ignore_check_constraints = OFF");

    await expect(
      authenticateLisaPassword("the configured password", db),
    ).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
  });
});
