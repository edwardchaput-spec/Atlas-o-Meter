import { NextResponse } from "next/server";

import { jsonError, parseJsonBody } from "@/lib/api";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { createSkill } from "@/lib/db";
import { skillCreateSchema } from "@/lib/domain";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = skillCreateSchema.parse(await parseJsonBody(request, 2048));
    const result = createSkill(input, user.slug);
    return NextResponse.json(result, {
      status: result.created ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
