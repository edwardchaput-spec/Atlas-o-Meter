import { NextResponse } from "next/server";

import { assertSameOrigin, setWebAuthnChallengeCookie } from "@/lib/auth";
import { createWebAuthnChallenge } from "@/lib/auth-db";
import { jsonError, parseJsonBody } from "@/lib/api";
import { loginSchema } from "@/lib/domain";
import { createAuthenticationOptions } from "@/lib/webauthn";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { username } = loginSchema.parse(await parseJsonBody(request, 2048));
    const options = await createAuthenticationOptions(username);
    const challengeId = createWebAuthnChallenge(
      username,
      "authentication",
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
