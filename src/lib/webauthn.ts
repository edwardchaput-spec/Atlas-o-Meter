import { createHash } from "node:crypto";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

import {
  assertPasskeyAttemptAllowed,
  getPasskey,
  listPasskeys,
  savePasskey,
  updatePasskeyCounter,
} from "@/lib/auth-db";
import { displayName } from "@/lib/domain";
import { AppError } from "@/lib/errors";
import type { UserSlug } from "@/lib/types";

interface WebAuthnConfig {
  origin: string;
  rpID: string;
}

function webAuthnConfig(): WebAuthnConfig {
  const originValue = process.env.WEBAUTHN_ORIGIN ?? process.env.APP_ORIGIN;
  if (!originValue) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("WEBAUTHN_ORIGIN or APP_ORIGIN is required.");
    }
    return { origin: "http://localhost:3000", rpID: "localhost" };
  }

  const parsed = new URL(originValue);
  const origin = parsed.origin;
  if (originValue !== origin || parsed.pathname !== "/") {
    throw new Error(
      "WEBAUTHN_ORIGIN must be an origin without a path or slash.",
    );
  }
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    throw new Error("WEBAUTHN_ORIGIN must use HTTPS outside localhost.");
  }

  const rpID = process.env.WEBAUTHN_RP_ID ?? parsed.hostname;
  if (parsed.hostname !== rpID && !parsed.hostname.endsWith(`.${rpID}`)) {
    throw new Error("WEBAUTHN_RP_ID must match the configured origin host.");
  }
  return { origin, rpID };
}

function userID(user: UserSlug): Uint8Array<ArrayBuffer> {
  const digest = createHash("sha256").update(`atlas-o-meter:${user}`).digest();
  const id = new Uint8Array(digest.byteLength);
  id.set(digest);
  return id;
}

export async function createRegistrationOptions(
  user: UserSlug,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = webAuthnConfig();
  const passkeys = listPasskeys(user);
  return generateRegistrationOptions({
    rpName: "Atlas-o-meter",
    rpID,
    userID: userID(user),
    userName: user,
    userDisplayName: displayName(user),
    attestationType: "none",
    excludeCredentials: passkeys.map((passkey) => ({
      id: passkey.id,
      transports: passkey.transports,
    })),
    preferredAuthenticatorType: "localDevice",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    supportedAlgorithmIDs: [-7, -257],
    timeout: 60_000,
  });
}

export async function completeRegistration(
  user: UserSlug,
  expectedChallenge: string,
  response: RegistrationResponseJSON,
): Promise<void> {
  const { origin, rpID } = webAuthnConfig();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    });
  } catch {
    throw new AppError(
      400,
      "PASSKEY_REGISTRATION_FAILED",
      "Phone unlock could not be registered. Please try again.",
    );
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError(
      400,
      "PASSKEY_REGISTRATION_FAILED",
      "Phone unlock could not be registered. Please try again.",
    );
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;
  savePasskey(user, credential, credentialDeviceType, credentialBackedUp);
}

export async function createAuthenticationOptions(
  user: UserSlug,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  assertPasskeyAttemptAllowed(user);
  const passkeys = listPasskeys(user);
  if (passkeys.length === 0) {
    throw new AppError(
      404,
      "PASSKEY_NOT_CONFIGURED",
      "No phone unlock is registered yet. Use your usual sign-in instead.",
    );
  }
  const { rpID } = webAuthnConfig();
  return generateAuthenticationOptions({
    rpID,
    allowCredentials: passkeys.map((passkey) => ({
      id: passkey.id,
      transports: passkey.transports,
    })),
    userVerification: "required",
    timeout: 60_000,
  });
}

export async function completeAuthentication(
  user: UserSlug,
  expectedChallenge: string,
  response: AuthenticationResponseJSON,
): Promise<void> {
  const passkey = getPasskey(user, response.id);
  if (!passkey) {
    throw new AppError(
      401,
      "PASSKEY_NOT_FOUND",
      "That phone unlock is not registered. Use your usual sign-in instead.",
    );
  }
  const { origin, rpID } = webAuthnConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });
  } catch {
    throw new AppError(
      401,
      "PASSKEY_VERIFICATION_FAILED",
      "Phone unlock was not confirmed. Use your usual sign-in or try again.",
    );
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    throw new AppError(
      401,
      "PASSKEY_VERIFICATION_FAILED",
      "Phone unlock was not confirmed. Use your usual sign-in or try again.",
    );
  }
  updatePasskeyCounter(
    user,
    passkey.id,
    passkey.counter,
    verification.authenticationInfo.newCounter,
  );
}
