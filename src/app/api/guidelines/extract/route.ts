import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { MAX_GUIDELINE_BYTES } from "@/lib/guidelines";

export const runtime = "nodejs";

const textTypes = /\.(txt|md|csv|json)$/i;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was sent." }, { status: 400 });
  }
  if (file.size > MAX_GUIDELINE_BYTES) {
    return NextResponse.json({ error: "That file is over 5 MB." }, { status: 413 });
  }

  const name = file.name;
  try {
    let text: string;
    if (/\.pdf$/i.test(name)) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      text = (await extractText(pdf, { mergePages: true })).text;
    } else if (/\.docx$/i.test(name)) {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })).value;
    } else if (textTypes.test(name)) {
      text = await file.text();
    } else {
      return NextResponse.json(
        { error: "Upload a PDF, Word (.docx), or text file (.txt, .md, .csv, .json)." },
        { status: 415 },
      );
    }
    if (!text.trim()) {
      return NextResponse.json(
        { error: "No readable text found. Scanned PDFs need to be run through OCR first." },
        { status: 422 },
      );
    }
    return NextResponse.json({ name, size: file.size, text });
  } catch {
    return NextResponse.json({ error: "That file couldn't be read." }, { status: 422 });
  }
}
