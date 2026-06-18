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

  const conversation = await store.setConversationStatus(id, "human_active", user.id);
  await store.addMessage({
    conversationId: id,
    role: "system",
    content: `${user.username} took over the conversation.`,
  });
  const updated = await store.getConversation(id);
  if (updated) publishConversation(updated);
  await emitWebhook("handoff.started", conversation);
  return NextResponse.json({ conversation: updated ?? conversation });
}
