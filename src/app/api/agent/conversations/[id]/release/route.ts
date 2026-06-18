import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAgent();
  if (!user) return unauthorized();
  const { id } = await context.params;
  const existing = await store.getConversation(id);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const conversation = await store.setConversationStatus(id, "ai_active");
  await store.addMessage({
    conversationId: id,
    role: "system",
    content: `${user.username} released the conversation back to AI.`,
  });
  const updated = await store.getConversation(id);
  if (updated) publishConversation(updated);
  await emitWebhook("handoff.released", conversation);
  return NextResponse.json({ conversation: updated ?? conversation });
}
