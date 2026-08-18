import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { getHistory } from "@/lib/db";
import { historyQuerySchema } from "@/lib/domain";

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const query = historyQuerySchema.parse({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    return NextResponse.json(getHistory(query.from, query.to), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
