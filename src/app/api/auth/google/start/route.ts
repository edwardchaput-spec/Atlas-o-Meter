import { NextResponse } from "next/server";

import { jsonError, parseJsonBody } from "@/lib/api";
import { assertSameOrigin, setGoogleAuthCookie } from "@/lib/auth";
import {
  assertGoogleStartAllowed,
  createGoogleAuthChallenge,
} from "@/lib/auth-db";
import { googleLoginSchema } from "@/lib/domain";
import { createGoogleAuthorizationRequest } from "@/lib/google-oidc";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { username } = googleLoginSchema.parse(
      await parseJsonBody(request, 2048),
    );
    assertGoogleStartAllowed(username);
    const authorization = await createGoogleAuthorizationRequest();
    const challenge = createGoogleAuthChallenge(username, authorization);
    const response = NextResponse.json(
      { authorizationUrl: authorization.authorizationUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
    setGoogleAuthCookie(response, challenge.id);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
