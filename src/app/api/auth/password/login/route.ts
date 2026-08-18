import { NextResponse } from "next/server";

import { jsonError, parseJsonBody } from "@/lib/api";
import { assertSameOrigin, setSessionCookie } from "@/lib/auth";
import { displayName, passwordLoginSchema } from "@/lib/domain";
import { authenticateLisaPassword } from "@/lib/password-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { username, password } = passwordLoginSchema.parse(
      await parseJsonBody(request, 2048),
    );
    await authenticateLisaPassword(password);
    const response = NextResponse.json(
      { user: { slug: username, displayName: displayName(username) } },
      { headers: { "Cache-Control": "no-store" } },
    );
    setSessionCookie(response, username);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
