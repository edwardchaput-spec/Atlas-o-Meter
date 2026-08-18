import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { createStarAdjustment } from "@/lib/db";
import { starAdjustmentSchema } from "@/lib/domain";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = starAdjustmentSchema.parse(await request.json());
    const result = createStarAdjustment(input, user.slug);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return jsonError(error);
  }
}
