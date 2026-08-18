import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  assertSameOrigin,
  clearWebAuthnChallengeCookie,
  requireUser,
  WEBAUTHN_CHALLENGE_COOKIE,
} from "@/lib/auth";
import { consumeWebAuthnChallenge, getPasskeyCount } from "@/lib/auth-db";
import { jsonError, parseJsonBody } from "@/lib/api";
import { webAuthnRegistrationResponseSchema } from "@/lib/domain";
import { completeRegistration } from "@/lib/webauthn";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const cookieStore = await cookies();
    const expectedChallenge = consumeWebAuthnChallenge(
      cookieStore.get(WEBAUTHN_CHALLENGE_COOKIE)?.value,
      user.slug,
      "registration",
    );
    const parsed = webAuthnRegistrationResponseSchema.parse(
      await parseJsonBody(request, 160_000),
    ) as unknown as RegistrationResponseJSON;
    await completeRegistration(user.slug, expectedChallenge, parsed);
    const response = NextResponse.json(
      { ok: true, count: getPasskeyCount(user.slug) },
      { headers: { "Cache-Control": "no-store" } },
    );
    clearWebAuthnChallengeCookie(response);
    return response;
  } catch (error) {
    const response = jsonError(error);
    clearWebAuthnChallengeCookie(response);
    return response;
  }
}
