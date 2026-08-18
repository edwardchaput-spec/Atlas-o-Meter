import { NextResponse } from "next/server";

import { jsonError, parseJsonBody } from "@/lib/api";
import { assertSameOrigin, requireEdward } from "@/lib/auth";
import { getLisaPasswordStatus } from "@/lib/auth-db";
import { lisaPasswordUpdateSchema } from "@/lib/domain";
import { replaceLisaPassword } from "@/lib/password-auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireEdward();
    return NextResponse.json(getLisaPasswordStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireEdward();
    const { password } = lisaPasswordUpdateSchema.parse(
      await parseJsonBody(request, 2048),
    );
    const status = await replaceLisaPassword(password, user.slug);
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
