import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-runtime";
import {
  extractWhatsAppTextMessages,
  postWhatsAppTextMessage,
  verifyWhatsAppWebhook,
  whatsAppConversationMetadata,
  whatsAppMessageMetadata,
  whatsAppVisitorSessionId,
  type WhatsAppIncomingTextMessage,
  type WhatsAppWebhookPayload,
} from "@/lib/channel-adapters";
import { conversationEventPayload, handoffEventPayload, messageEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { notifyVisitorMessage } from "@/lib/notifications";
import { store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return NextResponse.json({ error: "Invalid WhatsApp verification token" }, { status: 403 });
}

async function handleIncomingMessage(input: WhatsAppIncomingTextMessage) {
  const visitorSessionId = whatsAppVisitorSessionId(input);
  const externalUserId = `whatsapp:${input.from}`;
  let conversation = await store.getConversationByVisitorSession(visitorSessionId);
  if (conversation?.messages.some((message) => message.metadata?.whatsAppMessageId === input.messageId)) {
    return { duplicate: true, conversationId: conversation.id, messageId: input.messageId };
  }

  let created = false;
  const metadata = whatsAppConversationMetadata(input);
  if (!conversation) {
    conversation = await store.createConversation({
      visitorSessionId,
      externalUserId,
      subject: input.text.slice(0, 80),
      metadata,
    });
    created = true;
  } else {
    conversation = await store.bindConversationExternalUser(conversation.id, externalUserId, metadata);
  }
  if (created) await emitWebhook("conversation.created", conversationEventPayload(conversation, { source: "whatsapp" }));

  const visitorMessage = await store.addMessage({
    conversationId: conversation.id,
    role: "visitor",
    content: input.text,
    metadata: whatsAppMessageMetadata(input),
  });
  await emitWebhook("message.created", messageEventPayload(visitorMessage, conversation));

  let updated = await store.getConversation(conversation.id);
  if (!updated) throw new Error("Conversation not found");
  publishConversation(updated);
  void notifyVisitorMessage(updated, visitorMessage);

  let whatsAppDelivery:
    | Awaited<ReturnType<typeof postWhatsAppTextMessage>>
    | { status: "skipped"; reason: "ai_not_active" | "no_ai_reply" };
  if (updated.status === "ai_active") {
    const result = await generateAgentReply(updated);
    updated = await store.getConversation(updated.id);
    if (result.reply) {
      await emitWebhook("message.created", messageEventPayload(result.reply, updated));
      whatsAppDelivery = await postWhatsAppTextMessage({
        phoneNumberId: input.phoneNumberId,
        to: input.from,
        text: result.reply.content,
      });
    } else {
      whatsAppDelivery = { status: "skipped", reason: "no_ai_reply" };
    }
    if (result.action === "handoff" && updated) {
      await emitWebhook("handoff.started", handoffEventPayload(updated, { reason: result.reason }));
    }
    if (updated) publishConversation(updated);
  } else {
    whatsAppDelivery = { status: "skipped", reason: "ai_not_active" };
  }

  return {
    duplicate: false,
    conversationId: updated?.id ?? conversation.id,
    messageId: visitorMessage.id,
    whatsAppDelivery,
  };
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyWhatsAppWebhook(raw, request.headers)) {
    return NextResponse.json({ error: "Invalid WhatsApp signature" }, { status: 401 });
  }

  let body: WhatsAppWebhookPayload;
  try {
    body = JSON.parse(raw || "{}") as WhatsAppWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = extractWhatsAppTextMessages(body);
  if (!messages.length) return NextResponse.json({ ok: true, ignored: true });

  const results = [];
  for (const message of messages) {
    results.push(await handleIncomingMessage(message));
  }
  return NextResponse.json({ ok: true, adapter: "whatsapp", results });
}
