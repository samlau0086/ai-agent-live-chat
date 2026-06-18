import { NextResponse } from "next/server";
import { getAIProvider } from "@/lib/ai";
import { getOrCreateVisitorSession } from "@/lib/auth";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { tools } from "@/lib/tools";
import { emitWebhook } from "@/lib/webhooks";

export async function POST(request: Request) {
  const visitorSessionId = await getOrCreateVisitorSession();
  const body = (await request.json().catch(() => ({}))) as { content?: string };
  const content = String(body.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const before = await store.getConversationByVisitorSession(visitorSessionId);
  const conversation = await store.getOrCreateConversation(visitorSessionId);
  if (!before) await emitWebhook("conversation.created", conversation);

  await store.addMessage({ conversationId: conversation.id, role: "visitor", content });
  await emitWebhook("message.created", { conversationId: conversation.id, role: "visitor", content });

  let updated = await store.getConversation(conversation.id);
  if (!updated) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  publishConversation(updated);

  if (updated.status === "ai_active") {
    const provider = getAIProvider();
    const reply = await provider.generateReply({
      conversation: updated,
      messages: updated.messages,
      tools,
    });
    const aiMessage = await store.addMessage({ conversationId: updated.id, role: "ai", content: reply });
    await emitWebhook("message.created", aiMessage);
    updated = await store.getConversation(updated.id);
    if (updated) publishConversation(updated);
  }

  return NextResponse.json({ conversation: updated });
}
