import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { displayName } from "@/lib/domain";
import { AppError } from "@/lib/errors";
import { USER_SLUGS, type SessionUser, type UserSlug } from "@/lib/types";

export const SESSION_COOKIE = "atlas_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const WEBAUTHN_CHALLENGE_COOKIE = "atlas_webauthn_challenge";
export const WEBAUTHN_CHALLENGE_MAX_AGE_SECONDS = 5 * 60;
export const GOOGLE_AUTH_COOKIE = "atlas_google_login";
export const GOOGLE_AUTH_MAX_AGE_SECONDS = 10 * 60;

interface SessionPayload {
  user: UserSlug;
  expiresAt: number;
}

function sessionSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must contain at least 32 characters in production.",
    );
  }
  return "atlas-o-meter-local-development-secret";
}

function signature(payload: string): string {
  return createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

export function createSessionToken(user: UserSlug, now = Date.now()): string {
  const payload: SessionPayload = {
    user,
    expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifySessionToken(
  token: string | undefined,
  now = Date.now(),
): SessionUser | null {
  if (!token) return null;
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return null;

  const expected = signature(encoded);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (!USER_SLUGS.includes(payload.user) || payload.expiresAt <= now)
      return null;
    return { slug: payload.user, displayName: displayName(payload.user) };
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user)
    throw new AppError(401, "UNAUTHENTICATED", "Please sign in again.");
  return user;
}

export async function requireEdward(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.slug !== "edward") {
    throw new AppError(
      403,
      "EDWARD_REQUIRED",
      "Only Edward can manage Lisa's password.",
    );
  }
  return user;
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setSessionCookie(response: NextResponse, user: UserSlug): void {
  response.cookies.set(SESSION_COOKIE, createSessionToken(user), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    expires: new Date(0),
    path: "/",
  });
}

export function setWebAuthnChallengeCookie(
  response: NextResponse,
  challengeId: string,
): void {
  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, challengeId, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    maxAge: WEBAUTHN_CHALLENGE_MAX_AGE_SECONDS,
    path: "/api/auth/passkeys",
  });
}

export function clearWebAuthnChallengeCookie(response: NextResponse): void {
  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    expires: new Date(0),
    path: "/api/auth/passkeys",
  });
}

export function setGoogleAuthCookie(
  response: NextResponse,
  challengeId: string,
): void {
  response.cookies.set(GOOGLE_AUTH_COOKIE, challengeId, {
    httpOnly: true,
    secure: secureCookies(),
    // The callback is a top-level navigation from accounts.google.com.
    sameSite: "lax",
    maxAge: GOOGLE_AUTH_MAX_AGE_SECONDS,
    path: "/api/auth/google/callback",
  });
}

export function clearGoogleAuthCookie(response: NextResponse): void {
  response.cookies.set(GOOGLE_AUTH_COOKIE, "", {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    expires: new Date(0),
    path: "/api/auth/google/callback",
  });
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  // Behind NPM the Request URL may be the internal upstream, so production
  // trusts only the fixed public origin—not client-supplied forwarded headers.
  const allowedOrigin = process.env.APP_ORIGIN?.trim() || requestOrigin;
  if (!origin || origin !== allowedOrigin) {
    throw new AppError(
      403,
      "INVALID_ORIGIN",
      "This request did not come from Atlas-o-meter.",
    );
  }
}
