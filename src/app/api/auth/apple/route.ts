import { beginOAuth } from "@/lib/auth/oauth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return beginOAuth(request, "apple");
}
