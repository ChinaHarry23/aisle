import { NextResponse } from "next/server";
import { bundledRetail, type BundledRetailId } from "@/lib/retail/bundled";

export const runtime = "nodejs";

/** The local demo file, so a founder can download the same JSON the brand button loads. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const file = bundledRetail[id as BundledRetailId];
  if (!file) return NextResponse.json({ error: "Unknown retail data file." }, { status: 404 });
  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${id}-retail-data.json"`,
      "Cache-Control": "no-store",
    },
  });
}
