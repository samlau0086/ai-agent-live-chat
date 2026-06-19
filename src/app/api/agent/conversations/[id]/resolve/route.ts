import { NextResponse } from "next/server";
import { requireActiveAgentRequest } from "@/lib/auth";
import { conversationEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveAgentRequest("agent.conversations.resolve");
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const existing = await store.getConversation(id);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  await store.setConversationStatus(id, "resolved", auth.user.id);
  await store.addMessage({
    conversationId: id,
    role: "system",
    content: `${auth.user.username} marked the conversation resolved.`,
  });
  const updated = await store.getConversation(id);
  if (updated) publishConversation(updated);
  if (updated) await emitWebhook("conversation.resolved", conversationEventPayload(updated, { actorId: auth.user.id }));
  return NextResponse.json({ conversation: updated });
}
