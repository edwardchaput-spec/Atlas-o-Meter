import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { createBehavior } from "@/lib/db";
import { behaviorCreateSchema } from "@/lib/domain";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = behaviorCreateSchema.parse(await request.json());
    const result = createBehavior(input, user.slug);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return jsonError(error);
  }
}
