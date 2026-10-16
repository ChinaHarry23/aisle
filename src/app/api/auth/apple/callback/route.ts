import { completeApple } from "@/lib/auth/oauth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export function POST(request: NextRequest) {
  return completeApple(request);
}
