import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  clearGoogleAuthCookie,
  GOOGLE_AUTH_COOKIE,
  setSessionCookie,
} from "@/lib/auth";
import {
  assertGoogleCallbackAllowed,
  consumeGoogleAuthChallenge,
} from "@/lib/auth-db";
import { AppError } from "@/lib/errors";
import {
  atlasLoginUrl,
  completeGoogleAuthentication,
  googleCompletionUrl,
  publicGoogleCallbackUrl,
} from "@/lib/google-oidc";
import type { UserSlug } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicErrorCode(error: unknown): string {
  if (!(error instanceof AppError)) return "verification_failed";
  if (error.code === "GOOGLE_LOGIN_EXPIRED") return "expired";
  if (error.code === "GOOGLE_CANCELLED") return "cancelled";
  if (
    error.code === "GOOGLE_ACCOUNT_UNAUTHORISED" ||
    error.code === "GOOGLE_PROFILE_MISMATCH"
  ) {
    return "not_authorised";
  }
  if (error.code === "TOO_MANY_ATTEMPTS") return "too_many_attempts";
  return "verification_failed";
}

function protectRedirect(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  let selectedUser: UserSlug | undefined;
  try {
    const incoming = new URL(request.url);
    const cookieStore = await cookies();
    const challenge = consumeGoogleAuthChallenge(
      cookieStore.get(GOOGLE_AUTH_COOKIE)?.value,
      incoming.searchParams.get("state") ?? undefined,
    );
    selectedUser = challenge.userSlug;
    assertGoogleCallbackAllowed(challenge.userSlug);

    if (incoming.search.length > 8192) {
      throw new AppError(
        401,
        "GOOGLE_VERIFICATION_FAILED",
        "Google sign-in could not be verified.",
      );
    }

    const providerError = incoming.searchParams.get("error");
    if (providerError) {
      if (providerError !== "access_denied") {
        throw new AppError(
          401,
          "GOOGLE_VERIFICATION_FAILED",
          "Google sign-in could not be verified.",
        );
      }
      throw new AppError(
        401,
        "GOOGLE_CANCELLED",
        "Google sign-in was cancelled.",
      );
    }

    const user = await completeGoogleAuthentication(
      publicGoogleCallbackUrl(request.url),
      challenge,
    );
    const response = NextResponse.redirect(googleCompletionUrl(), 303);
    setSessionCookie(response, user.slug);
    clearGoogleAuthCookie(response);
    return protectRedirect(response);
  } catch (error) {
    const response = NextResponse.redirect(
      atlasLoginUrl(publicErrorCode(error), selectedUser),
      303,
    );
    clearGoogleAuthCookie(response);
    return protectRedirect(response);
  }
}
