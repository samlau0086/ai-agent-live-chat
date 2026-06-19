import { NextResponse } from "next/server";
import { getVisitorSession } from "@/lib/auth";
import { publishConversation } from "@/lib/events";
import { sanitizeConversationForVisitor, store } from "@/lib/store";

export async function POST(request: Request) {
  const visitorSessionId = await getVisitorSession();
  if (!visitorSessionId) return NextResponse.json({ error: "No visitor session" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { rating?: number; comment?: string };
  const rating = Math.max(1, Math.min(5, Number(body.rating)));
  if (!Number.isFinite(rating)) return NextResponse.json({ error: "rating must be 1-5" }, { status: 400 });

  const existing = await store.getConversationByVisitorSession(visitorSessionId);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const conversation = await store.mergeConversationMetadata(existing.id, {
    satisfaction: {
      rating,
      comment: body.comment ? String(body.comment).trim() : undefined,
      submittedAt: new Date().toISOString(),
    },
  });
  publishConversation(conversation);
  return NextResponse.json({ conversation: sanitizeConversationForVisitor(conversation) });
}
