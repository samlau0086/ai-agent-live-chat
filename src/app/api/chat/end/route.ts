import { NextResponse } from "next/server";
import { getVisitorSession } from "@/lib/auth";
import { conversationEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { sanitizeConversationForVisitor, store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

export async function POST() {
  const visitorSessionId = await getVisitorSession();
  if (!visitorSessionId) return NextResponse.json({ error: "No visitor session" }, { status: 404 });

  const existing = await store.getConversationByVisitorSession(visitorSessionId);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (existing.status === "closed") return NextResponse.json({ conversation: sanitizeConversationForVisitor(existing) });

  const conversation = await store.setConversationStatus(existing.id, "closed");
  await store.addMessage({
    conversationId: existing.id,
    role: "system",
    content: "The visitor ended the conversation.",
    metadata: { source: "visitor" },
  });
  const updated = (await store.getConversation(existing.id)) ?? conversation;
  publishConversation(updated);
  await emitWebhook("conversation.closed", conversationEventPayload(updated, { source: "visitor" }));
  return NextResponse.json({ conversation: sanitizeConversationForVisitor(updated) });
}
