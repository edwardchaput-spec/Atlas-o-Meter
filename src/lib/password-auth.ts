import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import type Database from "better-sqlite3";

import {
  assertLisaPasswordAttemptAllowed,
  clearLisaPasswordAttempts,
  getLisaPasswordCredential,
  saveLisaPasswordCredential,
  type PasswordCredentialInput,
  type StoredPasswordCredential,
} from "@/lib/auth-db";
import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { UserSlug } from "@/lib/types";

export const PASSWORD_SCRYPT_PARAMETERS = {
  algorithm: "scrypt",
  costN: 32_768,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
  saltLength: 16,
} as const;

const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const DUMMY_SALT = Buffer.from("b1d5a845f21a9b06d3e8c74261490f7c", "hex");
const DUMMY_HASH = Buffer.alloc(PASSWORD_SCRYPT_PARAMETERS.keyLength);

interface ScryptParameters {
  costN: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
}

function derivePassword(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      parameters.keyLength,
      {
        N: parameters.costN,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function createPasswordCredential(
  password: string,
): Promise<PasswordCredentialInput> {
  const salt = randomBytes(PASSWORD_SCRYPT_PARAMETERS.saltLength);
  const passwordHash = await derivePassword(
    password,
    salt,
    PASSWORD_SCRYPT_PARAMETERS,
  );
  return {
    passwordHash,
    salt,
    algorithm: PASSWORD_SCRYPT_PARAMETERS.algorithm,
    costN: PASSWORD_SCRYPT_PARAMETERS.costN,
    blockSize: PASSWORD_SCRYPT_PARAMETERS.blockSize,
    parallelization: PASSWORD_SCRYPT_PARAMETERS.parallelization,
    keyLength: PASSWORD_SCRYPT_PARAMETERS.keyLength,
  };
}

async function credentialMatches(
  password: string,
  credential: StoredPasswordCredential | null,
): Promise<boolean> {
  const supportedCredential =
    credential &&
    credential.algorithm === PASSWORD_SCRYPT_PARAMETERS.algorithm &&
    credential.costN === PASSWORD_SCRYPT_PARAMETERS.costN &&
    credential.blockSize === PASSWORD_SCRYPT_PARAMETERS.blockSize &&
    credential.parallelization === PASSWORD_SCRYPT_PARAMETERS.parallelization &&
    credential.keyLength === PASSWORD_SCRYPT_PARAMETERS.keyLength &&
    credential.salt.length === PASSWORD_SCRYPT_PARAMETERS.saltLength &&
    credential.passwordHash.length === PASSWORD_SCRYPT_PARAMETERS.keyLength
      ? credential
      : null;
  const parameters = supportedCredential ?? PASSWORD_SCRYPT_PARAMETERS;
  const candidate = await derivePassword(
    password,
    supportedCredential?.salt ?? DUMMY_SALT,
    parameters,
  );
  const expected = supportedCredential?.passwordHash ?? DUMMY_HASH;
  return (
    supportedCredential !== null &&
    candidate.length === expected.length &&
    timingSafeEqual(candidate, expected)
  );
}

function credentialIsCurrent(
  verified: StoredPasswordCredential | null,
  current: StoredPasswordCredential | null,
): boolean {
  if (!verified || !current || verified.updatedAt !== current.updatedAt) {
    return false;
  }
  return (
    verified.salt.length === current.salt.length &&
    timingSafeEqual(verified.salt, current.salt) &&
    verified.passwordHash.length === current.passwordHash.length &&
    timingSafeEqual(verified.passwordHash, current.passwordHash)
  );
}

export async function replaceLisaPassword(
  password: string,
  actor: UserSlug,
  db: Database.Database = getDatabase(),
  now = new Date().toISOString(),
): Promise<{ configured: true; updatedAt: string }> {
  if (actor !== "edward") {
    throw new AppError(
      403,
      "EDWARD_REQUIRED",
      "Only Edward can manage Lisa's password.",
    );
  }
  const credential = await createPasswordCredential(password);
  return saveLisaPasswordCredential(credential, actor, db, now);
}

export async function authenticateLisaPassword(
  password: string,
  db: Database.Database = getDatabase(),
  now = Date.now(),
): Promise<void> {
  assertLisaPasswordAttemptAllowed(db, now);
  const credential = getLisaPasswordCredential(db);
  if (!(await credentialMatches(password, credential))) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "That password could not be verified.",
    );
  }
  if (!credentialIsCurrent(credential, getLisaPasswordCredential(db))) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "That password could not be verified.",
    );
  }
  clearLisaPasswordAttempts(db);
}
