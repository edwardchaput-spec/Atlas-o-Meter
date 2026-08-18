import { NextResponse } from "next/server";

import { assertSameOrigin, clearSessionCookie } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
