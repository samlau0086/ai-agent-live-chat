import { NextResponse } from "next/server";
import { requireActiveAgentRequest } from "@/lib/auth";
import { handoffEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveAgentRequest("agent.conversations.takeover");
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const existing = await store.getConversation(id);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const conversation = await store.setConversationStatus(id, "human_active", auth.user.id);
  await store.addMessage({
    conversationId: id,
    role: "system",
    content: `${auth.user.username} took over the conversation.`,
  });
  const updated = await store.getConversation(id);
  if (updated) publishConversation(updated);
  await emitWebhook("handoff.started", handoffEventPayload(updated ?? conversation, { actorId: auth.user.id }));
  return NextResponse.json({ conversation: updated ?? conversation });
}
