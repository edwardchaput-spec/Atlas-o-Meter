import { NextResponse } from "next/server";

import { checkDatabase } from "@/lib/db";

export function GET() {
  try {
    return NextResponse.json({
      status: checkDatabase() ? "ready" : "unavailable",
    });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
