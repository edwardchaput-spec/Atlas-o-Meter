import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moodSchema = z.enum(["happy", "sad"]);
const filenames = {
  happy: "atlas-happy.webp",
  sad: "atlas-tricky.webp",
} as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ mood: string }> },
) {
  try {
    await requireUser();
    const { mood: candidate } = await context.params;
    const mood = moodSchema.parse(candidate);
    const image = await readFile(
      join(process.cwd(), "private-assets", "avatars", filenames[mood]),
    );
    return new NextResponse(new Uint8Array(image), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "image/webp",
        "Content-Length": String(image.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
