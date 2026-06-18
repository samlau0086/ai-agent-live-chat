import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAgent();
  if (!user) return unauthorized();
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { content?: string };
  const content = String(body.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const conversation = await store.getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (conversation.status !== "human_active") {
    return NextResponse.json({ error: "Take over the conversation before replying" }, { status: 409 });
  }

  const message = await store.addMessage({
    conversationId: id,
    role: "human_agent",
    content,
    agentId: user.id,
  });
  const updated = await store.getConversation(id);
  if (updated) publishConversation(updated);
  await emitWebhook("message.created", message);
  return NextResponse.json({ conversation: updated, message });
}
