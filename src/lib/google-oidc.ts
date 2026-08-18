import * as oidc from "openid-client";

import type { GoogleAuthChallenge } from "@/lib/auth-db";
import { displayName } from "@/lib/domain";
import { AppError } from "@/lib/errors";
import type { SessionUser, UserSlug } from "@/lib/types";

const GOOGLE_ISSUER = new URL("https://accounts.google.com");
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

interface GoogleConfiguration {
  appOrigin: string;
  clientId: string;
  clientSecret: string;
  edwardEmail: string;
}

export interface GoogleIdentityClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

export interface GoogleAuthorizationRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export type GoogleCallbackVerifier = (
  callbackUrl: URL,
  challenge: GoogleAuthChallenge,
) => Promise<GoogleIdentityClaims>;

let cachedOidcConfiguration:
  { key: string; promise: Promise<oidc.Configuration> } | undefined;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Google Sign-In.`);
  return value;
}

function normaliseAllowedEmail(value: string, variable: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${variable} must be a valid email address.`);
  }
  return email;
}

function readGoogleConfiguration(): GoogleConfiguration {
  const appOriginValue = requiredEnvironment("APP_ORIGIN");
  const parsedOrigin = new URL(appOriginValue);
  if (
    parsedOrigin.origin !== appOriginValue ||
    parsedOrigin.username ||
    parsedOrigin.password
  ) {
    throw new Error("APP_ORIGIN must be an origin without a trailing slash.");
  }
  if (
    parsedOrigin.protocol !== "https:" &&
    parsedOrigin.hostname !== "localhost" &&
    parsedOrigin.hostname !== "127.0.0.1"
  ) {
    throw new Error("APP_ORIGIN must use HTTPS outside localhost.");
  }

  return {
    appOrigin: parsedOrigin.origin,
    clientId: requiredEnvironment("GOOGLE_CLIENT_ID"),
    clientSecret: requiredEnvironment("GOOGLE_CLIENT_SECRET"),
    edwardEmail: normaliseAllowedEmail(
      requiredEnvironment("ATLAS_EDWARD_EMAIL"),
      "ATLAS_EDWARD_EMAIL",
    ),
  };
}

function callbackUrl(configuration: GoogleConfiguration): string {
  return new URL(GOOGLE_CALLBACK_PATH, configuration.appOrigin).href;
}

async function oidcConfiguration(
  configuration: GoogleConfiguration,
): Promise<oidc.Configuration> {
  const key = `${configuration.clientId}\u0000${configuration.clientSecret}`;
  if (cachedOidcConfiguration?.key === key) {
    return cachedOidcConfiguration.promise;
  }

  const promise = oidc
    .discovery(
      GOOGLE_ISSUER,
      configuration.clientId,
      configuration.clientSecret,
    )
    .then((discovered) => {
      discovered.timeout = 10;
      // openid-client otherwise relies on the protected token endpoint for an
      // ID token returned by the code flow. Atlas explicitly verifies the JWS
      // signature as well as issuer, audience, expiry, state, and nonce.
      oidc.enableNonRepudiationChecks(discovered);
      return discovered;
    })
    .catch((error: unknown) => {
      if (cachedOidcConfiguration?.key === key) {
        cachedOidcConfiguration = undefined;
      }
      throw error;
    });
  cachedOidcConfiguration = { key, promise };
  return promise;
}

export function googleRedirectUri(): string {
  return callbackUrl(readGoogleConfiguration());
}

export async function createGoogleAuthorizationRequest(): Promise<GoogleAuthorizationRequest> {
  const configuration = readGoogleConfiguration();
  let client: oidc.Configuration;
  try {
    client = await oidcConfiguration(configuration);
  } catch {
    throw new AppError(
      503,
      "GOOGLE_UNAVAILABLE",
      "Google sign-in is unavailable right now. Please try again shortly.",
    );
  }

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const authorizationUrl = oidc.buildAuthorizationUrl(client, {
    client_id: configuration.clientId,
    redirect_uri: callbackUrl(configuration),
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });

  return {
    authorizationUrl: authorizationUrl.href,
    state,
    nonce,
    codeVerifier,
  };
}

async function verifyWithGoogle(
  currentUrl: URL,
  challenge: GoogleAuthChallenge,
): Promise<GoogleIdentityClaims> {
  const configuration = readGoogleConfiguration();
  const client = await oidcConfiguration(configuration);
  const tokens = await oidc.authorizationCodeGrant(client, currentUrl, {
    pkceCodeVerifier: challenge.codeVerifier,
    expectedState: challenge.state,
    expectedNonce: challenge.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error("Google did not return an ID token.");
  return claims;
}

export function mapGoogleIdentityToAtlasUser(
  selectedUser: UserSlug,
  claims: GoogleIdentityClaims,
): SessionUser {
  const configuration = readGoogleConfiguration();
  if (
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    typeof claims.email !== "string" ||
    claims.email_verified !== true
  ) {
    throw new AppError(
      401,
      "GOOGLE_ACCOUNT_UNAUTHORISED",
      "That Google account isn't authorised for this Atlas profile.",
    );
  }

  if (selectedUser !== "edward") {
    throw new AppError(
      403,
      "GOOGLE_PROFILE_MISMATCH",
      "That Google account isn't authorised for this Atlas profile.",
    );
  }

  const email = claims.email.trim().toLowerCase();
  if (email !== configuration.edwardEmail) {
    throw new AppError(
      403,
      "GOOGLE_ACCOUNT_UNAUTHORISED",
      "That Google account isn't authorised for this Atlas profile.",
    );
  }
  return { slug: "edward", displayName: displayName("edward") };
}

export async function completeGoogleAuthentication(
  callbackRequestUrl: URL,
  challenge: GoogleAuthChallenge,
  verifier: GoogleCallbackVerifier = verifyWithGoogle,
): Promise<SessionUser> {
  let claims: GoogleIdentityClaims;
  try {
    claims = await verifier(callbackRequestUrl, challenge);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      401,
      "GOOGLE_VERIFICATION_FAILED",
      "Google sign-in could not be verified. Please try again.",
    );
  }
  return mapGoogleIdentityToAtlasUser(challenge.userSlug, claims);
}

export function publicGoogleCallbackUrl(requestUrl: string): URL {
  const configuration = readGoogleConfiguration();
  const incoming = new URL(requestUrl);
  const callback = new URL(GOOGLE_CALLBACK_PATH, configuration.appOrigin);
  callback.search = incoming.search;
  return callback;
}

export function atlasLoginUrl(error?: string, user?: UserSlug): URL {
  const configuration = readGoogleConfiguration();
  const target = new URL("/", configuration.appOrigin);
  if (error) target.searchParams.set("authError", error);
  if (user) target.searchParams.set("profile", user);
  return target;
}

export function googleCompletionUrl(): URL {
  const configuration = readGoogleConfiguration();
  return new URL("/auth/google/complete", configuration.appOrigin);
}
