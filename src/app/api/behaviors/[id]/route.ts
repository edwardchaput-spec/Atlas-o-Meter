import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError } from "@/lib/api";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { deleteBehavior, updateBehavior } from "@/lib/db";
import { behaviorDeleteSchema, behaviorUpdateSchema } from "@/lib/domain";

const idSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const input = behaviorUpdateSchema.parse(await request.json());
    return NextResponse.json(updateBehavior(id, input, user.slug));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const { version } = behaviorDeleteSchema.parse(await request.json());
    return NextResponse.json(deleteBehavior(id, version, user.slug));
  } catch (error) {
    return jsonError(error);
  }
}
