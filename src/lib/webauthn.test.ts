import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webAuthnServerMocks = vi.hoisted(() => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

const authDbMocks = vi.hoisted(() => ({
  assertPasskeyAttemptAllowed: vi.fn(),
  getPasskey: vi.fn(),
  listPasskeys: vi.fn(),
  savePasskey: vi.fn(),
  updatePasskeyCounter: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => webAuthnServerMocks);
vi.mock("@/lib/auth-db", () => authDbMocks);

import {
  completeAuthentication,
  completeRegistration,
  createAuthenticationOptions,
  createRegistrationOptions,
} from "@/lib/webauthn";

const PASSKEY = {
  id: "registered-credential",
  userSlug: "edward" as const,
  publicKey: new Uint8Array([1, 2, 3, 4]),
  counter: 7,
  transports: ["internal" as const],
  deviceType: "singleDevice" as const,
  backedUp: false,
  createdAt: "2026-08-09T10:00:00.000Z",
  lastUsedAt: null,
};

const AUTHENTICATION_RESPONSE = {
  id: PASSKEY.id,
  rawId: PASSKEY.id,
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: "client-data",
    authenticatorData: "authenticator-data",
    signature: "signature",
  },
} as AuthenticationResponseJSON;

const REGISTRATION_RESPONSE = {
  id: "new-credential",
  rawId: "new-credential",
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: "client-data",
    attestationObject: "attestation",
  },
} as RegistrationResponseJSON;

describe("WebAuthn regression after Google migration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("WEBAUTHN_ORIGIN", "https://atlas.example.test");
    vi.stubEnv("WEBAUTHN_RP_ID", "atlas.example.test");
    authDbMocks.listPasskeys.mockReturnValue([PASSKEY]);
    authDbMocks.getPasskey.mockReturnValue(PASSKEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps passkey authentication available without invoking Google", async () => {
    const generatedOptions = {
      challenge: "server-authentication-challenge",
      rpId: "atlas.example.test",
    };
    webAuthnServerMocks.generateAuthenticationOptions.mockResolvedValue(
      generatedOptions,
    );

    await expect(createAuthenticationOptions("edward")).resolves.toBe(
      generatedOptions,
    );
    expect(authDbMocks.assertPasskeyAttemptAllowed).toHaveBeenCalledWith(
      "edward",
    );
    expect(
      webAuthnServerMocks.generateAuthenticationOptions,
    ).toHaveBeenCalledWith({
      rpID: "atlas.example.test",
      allowCredentials: [{ id: PASSKEY.id, transports: PASSKEY.transports }],
      userVerification: "required",
      timeout: 60_000,
    });
  });

  it("retains exact origin, RP ID, user verification and signature-counter handling", async () => {
    webAuthnServerMocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { userVerified: true, newCounter: 8 },
    });

    await expect(
      completeAuthentication(
        "edward",
        "expected-challenge",
        AUTHENTICATION_RESPONSE,
      ),
    ).resolves.toBeUndefined();
    expect(
      webAuthnServerMocks.verifyAuthenticationResponse,
    ).toHaveBeenCalledWith({
      response: AUTHENTICATION_RESPONSE,
      expectedChallenge: "expected-challenge",
      expectedOrigin: "https://atlas.example.test",
      expectedRPID: "atlas.example.test",
      credential: {
        id: PASSKEY.id,
        publicKey: PASSKEY.publicKey,
        counter: 7,
        transports: PASSKEY.transports,
      },
      requireUserVerification: true,
    });
    expect(authDbMocks.updatePasskeyCounter).toHaveBeenCalledWith(
      "edward",
      PASSKEY.id,
      7,
      8,
    );
  });

  it("does not update the counter when user verification fails", async () => {
    webAuthnServerMocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { userVerified: false, newCounter: 8 },
    });

    await expect(
      completeAuthentication(
        "edward",
        "expected-challenge",
        AUTHENTICATION_RESPONSE,
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: "PASSKEY_VERIFICATION_FAILED",
    });
    expect(authDbMocks.updatePasskeyCounter).not.toHaveBeenCalled();
  });

  it("keeps registration available to the authenticated Atlas actor", async () => {
    const registrationOptions = {
      challenge: "registration-challenge",
      rp: { id: "atlas.example.test", name: "Atlas-o-meter" },
    };
    webAuthnServerMocks.generateRegistrationOptions.mockResolvedValue(
      registrationOptions,
    );

    await expect(createRegistrationOptions("edward")).resolves.toBe(
      registrationOptions,
    );
    expect(
      webAuthnServerMocks.generateRegistrationOptions,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        rpName: "Atlas-o-meter",
        rpID: "atlas.example.test",
        userName: "edward",
        userDisplayName: "Edward",
        attestationType: "none",
        preferredAuthenticatorType: "localDevice",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        supportedAlgorithmIDs: [-7, -257],
      }),
    );
  });

  it("persists only the verified registration public credential", async () => {
    const credential = {
      id: "new-credential",
      publicKey: new Uint8Array([9, 8, 7]),
      counter: 0,
      transports: ["internal" as const],
    };
    webAuthnServerMocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    });

    await expect(
      completeRegistration(
        "edward",
        "expected-registration-challenge",
        REGISTRATION_RESPONSE,
      ),
    ).resolves.toBeUndefined();
    expect(webAuthnServerMocks.verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        response: REGISTRATION_RESPONSE,
        expectedChallenge: "expected-registration-challenge",
        expectedOrigin: "https://atlas.example.test",
        expectedRPID: "atlas.example.test",
        requireUserVerification: true,
      }),
    );
    expect(authDbMocks.savePasskey).toHaveBeenCalledWith(
      "edward",
      credential,
      "multiDevice",
      true,
    );
  });
});
