import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-runtime";
import {
  restConversationMetadata,
  restMessageMetadata,
  restVisitorSessionId,
  summarizeAdapterConversation,
  type RestIncomingMessageInput,
} from "@/lib/channel-adapters";
import { conversationEventPayload, handoffEventPayload, messageEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { emitWebhook, verifyWebhookSignature } from "@/lib/webhooks";

function parseObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-live-chat-signature") ?? "")) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: RestIncomingMessageInput;
  try {
    const parsed = JSON.parse(raw || "{}") as RestIncomingMessageInput;
    body = {
      ...parsed,
      metadata: parseObject(parsed.metadata),
      messageMetadata: parseObject(parsed.messageMetadata),
      profile: parseObject(parsed.profile),
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const content = String(body.content ?? "").trim();
  const conversationId = String(body.conversationId ?? "").trim();
  const externalConversationId = String(body.externalConversationId ?? "").trim();
  const externalUserId = String(body.externalUserId ?? "").trim();
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });
  if (!conversationId && !externalConversationId) {
    return NextResponse.json(
      { error: "conversationId or externalConversationId is required" },
      { status: 400 },
    );
  }

  let created = false;
  let conversation = conversationId
    ? await store.getConversation(conversationId)
    : await store.getConversationByVisitorSession(restVisitorSessionId(externalConversationId));
  if (!conversation && conversationId) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (!conversation) {
    conversation = await store.createConversation({
      visitorSessionId: restVisitorSessionId(externalConversationId),
      externalUserId: externalUserId || undefined,
      subject: body.subject,
      metadata: restConversationMetadata({ ...body, externalConversationId, externalUserId }),
    });
    created = true;
  } else if (externalUserId || body.metadata || body.profile) {
    const metadata = restConversationMetadata({ ...body, externalConversationId, externalUserId });
    conversation = externalUserId
      ? await store.bindConversationExternalUser(conversation.id, externalUserId, metadata)
      : await store.mergeConversationMetadata(conversation.id, metadata);
  }

  if (created) {
    await emitWebhook("conversation.created", conversationEventPayload(conversation, { source: "rest_adapter" }));
  }

  const visitorMessage = await store.addMessage({
    conversationId: conversation.id,
    role: "visitor",
    content,
    metadata: restMessageMetadata({ ...body, externalConversationId, externalUserId }),
  });
  await emitWebhook("message.created", messageEventPayload(visitorMessage, conversation));

  let updated = await store.getConversation(conversation.id);
  if (!updated) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  publishConversation(updated);

  let ai:
    | {
        action: "replied" | "handoff" | "skipped";
        reason?: string;
        replyMessageId?: string;
      }
    | undefined;
  if (updated.status === "ai_active") {
    const result = await generateAgentReply(updated);
    updated = await store.getConversation(updated.id);
    if (result.reply) await emitWebhook("message.created", messageEventPayload(result.reply, updated));
    if (result.action === "handoff" && updated) {
      await emitWebhook("handoff.started", handoffEventPayload(updated, { reason: result.reason }));
    }
    if (updated) publishConversation(updated);
    ai = {
      action: result.action,
      reason: result.reason,
      replyMessageId: result.reply?.id,
    };
  }

  return NextResponse.json({
    adapter: "rest",
    created,
    message: visitorMessage,
    ai,
    conversation: updated ? summarizeAdapterConversation(updated) : undefined,
  });
}
