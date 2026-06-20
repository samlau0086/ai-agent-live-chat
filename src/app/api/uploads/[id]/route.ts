import { NextResponse } from "next/server";
import { readMessageAttachment } from "@/lib/attachments";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const attachment = await readMessageAttachment(id);
  if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  return new Response(attachment.data, {
    headers: {
      "Content-Type": attachment.metadata.mimeType,
      "Content-Length": String(attachment.metadata.size),
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.metadata.fileName)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

