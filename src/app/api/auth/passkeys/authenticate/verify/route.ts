import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  assertSameOrigin,
  clearWebAuthnChallengeCookie,
  setSessionCookie,
  WEBAUTHN_CHALLENGE_COOKIE,
} from "@/lib/auth";
import { consumeWebAuthnChallenge } from "@/lib/auth-db";
import { jsonError, parseJsonBody } from "@/lib/api";
import { displayName, webAuthnAuthenticationRequestSchema } from "@/lib/domain";
import { completeAuthentication } from "@/lib/webauthn";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = webAuthnAuthenticationRequestSchema.parse(
      await parseJsonBody(request, 160_000),
    );
    const cookieStore = await cookies();
    const expectedChallenge = consumeWebAuthnChallenge(
      cookieStore.get(WEBAUTHN_CHALLENGE_COOKIE)?.value,
      parsed.username,
      "authentication",
    );
    await completeAuthentication(
      parsed.username,
      expectedChallenge,
      parsed.response as unknown as AuthenticationResponseJSON,
    );
    const response = NextResponse.json(
      {
        user: {
          slug: parsed.username,
          displayName: displayName(parsed.username),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    setSessionCookie(response, parsed.username);
    clearWebAuthnChallengeCookie(response);
    return response;
  } catch (error) {
    const response = jsonError(error);
    clearWebAuthnChallengeCookie(response);
    return response;
  }
}
