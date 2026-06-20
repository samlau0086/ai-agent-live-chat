import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-runtime";
import { saveMessageAttachments } from "@/lib/attachments";
import { getOrCreateVisitorSession } from "@/lib/auth";
import { hasRequiredVisitorProfile } from "@/lib/chat-profile";
import { conversationEventPayload, handoffEventPayload, messageEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { sanitizeConversationForVisitor, store } from "@/lib/store";
import { visitorMessageMetadata, detectLanguage } from "@/lib/translation";
import { emitWebhook } from "@/lib/webhooks";

async function parseMessageRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const files = form.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0);
    return {
      content: String(form.get("content") ?? "").trim(),
      files,
    };
  }
  const body = (await request.json().catch(() => ({}))) as { content?: string };
  return { content: String(body.content ?? "").trim(), files: [] as File[] };
}

export async function POST(request: Request) {
  const visitorSessionId = await getOrCreateVisitorSession();
  const { content, files } = await parseMessageRequest(request);
  if (!content && !files.length) return NextResponse.json({ error: "content or attachment is required" }, { status: 400 });

  const before = await store.getConversationByVisitorSession(visitorSessionId);
  const conversation = await store.getOrCreateConversation(visitorSessionId);
  if (!before) await emitWebhook("conversation.created", conversationEventPayload(conversation, { source: "widget" }));
  if (!hasRequiredVisitorProfile(conversation)) {
    return NextResponse.json({ error: "profile_required" }, { status: 409 });
  }

  let attachments;
  try {
    attachments = await saveMessageAttachments(files);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Attachment upload failed" }, { status: 400 });
  }

  const aiConfig = await store.getAIConfiguration();
  const messageContent = content || `Uploaded ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}.`;
  const visitorLanguage = detectLanguage(messageContent);
  const metadata = await visitorMessageMetadata({
    conversation,
    aiConfig,
    content: messageContent,
    metadata: attachments.length ? { attachments } : undefined,
  });
  if (aiConfig.translationEnabled && content) {
    await store.mergeConversationMetadata(conversation.id, {
      translation: {
        ...((conversation.metadata.translation && typeof conversation.metadata.translation === "object"
          ? conversation.metadata.translation
          : {}) as Record<string, unknown>),
        visitorLanguage,
      },
    });
  }
  const visitorMessage = await store.addMessage({ conversationId: conversation.id, role: "visitor", content: messageContent, metadata });
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
