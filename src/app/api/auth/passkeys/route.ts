import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getPasskeyCount } from "@/lib/auth-db";
import { jsonError } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(
      { count: getPasskeyCount(user.slug) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
