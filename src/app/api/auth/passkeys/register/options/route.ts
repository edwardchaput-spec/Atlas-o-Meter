import { NextResponse } from "next/server";

import {
  assertSameOrigin,
  requireUser,
  setWebAuthnChallengeCookie,
} from "@/lib/auth";
import { createWebAuthnChallenge } from "@/lib/auth-db";
import { jsonError } from "@/lib/api";
import { createRegistrationOptions } from "@/lib/webauthn";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const options = await createRegistrationOptions(user.slug);
    const challengeId = createWebAuthnChallenge(
      user.slug,
      "registration",
      options.challenge,
    );
    const response = NextResponse.json(options, {
      headers: { "Cache-Control": "no-store" },
    });
    setWebAuthnChallengeCookie(response, challengeId);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
