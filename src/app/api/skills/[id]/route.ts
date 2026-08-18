import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, parseJsonBody } from "@/lib/api";
import { assertSameOrigin, requireUser } from "@/lib/auth";
import { softDeleteSkill, updateSkill } from "@/lib/db";
import { skillDeleteSchema, skillUpdateSchema } from "@/lib/domain";

const idSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const input = skillUpdateSchema.parse(await parseJsonBody(request, 2048));
    return NextResponse.json(updateSkill(id, input, user.slug), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = idSchema.parse((await context.params).id);
    const { version } = skillDeleteSchema.parse(
      await parseJsonBody(request, 2048),
    );
    return NextResponse.json(softDeleteSkill(id, version, user.slug), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
