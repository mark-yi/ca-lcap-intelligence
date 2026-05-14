import { NextRequest } from "next/server";
import { z } from "zod";
import { assertApiKey } from "@/lib/env";
import { findOpportunities } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  topic: z.string().default("chronic_absenteeism"),
  outcomeTrend: z.string().default("worsening"),
  rankBy: z.string().default("strict_action_funds"),
  county: z.string().optional(),
  district: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  includeActions: z.coerce.boolean().default(true),
  actionLimit: z.coerce.number().int().min(1).max(10).default(3)
});

export async function GET(request: NextRequest) {
  const auth = assertApiKey(request);
  if (auth) {
    return auth;
  }

  try {
    const parsed = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const rows = await findOpportunities(parsed);
    return Response.json({ rows, count: rows.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
  }
}
