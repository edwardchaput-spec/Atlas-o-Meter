import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getDashboard } from "@/lib/db";
import { dashboardQuerySchema } from "@/lib/domain";

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const query = dashboardQuerySchema.parse({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    return NextResponse.json(getDashboard(query.from, query.to), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
