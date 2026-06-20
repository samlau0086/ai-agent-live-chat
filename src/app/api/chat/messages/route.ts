import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-runtime";
import { getOrCreateVisitorSession } from "@/lib/auth";
import { hasRequiredVisitorProfile } from "@/lib/chat-profile";
import { conversationEventPayload, handoffEventPayload, messageEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { sanitizeConversationForVisitor, store } from "@/lib/store";
import { visitorMessageMetadata, detectLanguage } from "@/lib/translation";
import { emitWebhook } from "@/lib/webhooks";

export async function POST(request: Request) {
  const visitorSessionId = await getOrCreateVisitorSession();
  const body = (await request.json().catch(() => ({}))) as { content?: string };
  const content = String(body.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const before = await store.getConversationByVisitorSession(visitorSessionId);
  const conversation = await store.getOrCreateConversation(visitorSessionId);
  if (!before) await emitWebhook("conversation.created", conversationEventPayload(conversation, { source: "widget" }));
  if (!hasRequiredVisitorProfile(conversation)) {
    return NextResponse.json({ error: "profile_required" }, { status: 409 });
  }

  const aiConfig = await store.getAIConfiguration();
  const visitorLanguage = detectLanguage(content);
  const metadata = await visitorMessageMetadata({ conversation, aiConfig, content });
  if (aiConfig.translationEnabled) {
    await store.mergeConversationMetadata(conversation.id, {
      translation: {
        ...((conversation.metadata.translation && typeof conversation.metadata.translation === "object"
          ? conversation.metadata.translation
          : {}) as Record<string, unknown>),
        visitorLanguage,
      },
    });
  }
  const visitorMessage = await store.addMessage({ conversationId: conversation.id, role: "visitor", content, metadata });
  await emitWebhook("message.created", messageEventPayload(visitorMessage, conversation));

  let updated = await store.getConversation(conversation.id);
  if (!updated) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  publishConversation(updated);

  if (updated.status === "ai_active") {
    const result = await generateAgentReply(updated);
    updated = await store.getConversation(updated.id);
    if (result.reply) await emitWebhook("message.created", messageEventPayload(result.reply, updated));
    if (result.action === "handoff" && updated) {
      await emitWebhook("handoff.started", handoffEventPayload(updated, { reason: result.reason }));
    }
    if (updated) publishConversation(updated);
  }

  return NextResponse.json({ conversation: updated ? sanitizeConversationForVisitor(updated) : updated });
}
