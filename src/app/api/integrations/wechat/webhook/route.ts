import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-runtime";
import {
  parseWeChatTextMessage,
  verifyWeChatSignature,
  weChatConversationMetadata,
  weChatMessageMetadata,
  weChatTextReply,
  weChatVisitorSessionId,
  type WeChatTextMessage,
} from "@/lib/channel-adapters";
import { conversationEventPayload, handoffEventPayload, messageEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

function signatureParams(request: Request) {
  const url = new URL(request.url);
  return {
    signature: url.searchParams.get("signature"),
    timestamp: url.searchParams.get("timestamp"),
    nonce: url.searchParams.get("nonce"),
    echostr: url.searchParams.get("echostr"),
  };
}

export async function GET(request: Request) {
  const params = signatureParams(request);
  if (!verifyWeChatSignature(params) || !params.echostr) {
    return NextResponse.json({ error: "Invalid WeChat signature" }, { status: 403 });
  }
  return new Response(params.echostr, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function handleTextMessage(message: WeChatTextMessage) {
  const visitorSessionId = weChatVisitorSessionId(message);
  const externalUserId = `wechat:${message.fromUserName}`;
  let conversation = await store.getConversationByVisitorSession(visitorSessionId);
  if (conversation?.messages.some((item) => item.metadata?.weChatMsgId === message.msgId)) {
    return weChatTextReply({
      toUserName: message.fromUserName,
      fromUserName: message.toUserName,
      content: "消息已收到。",
    });
  }

  let created = false;
  const metadata = weChatConversationMetadata(message);
  if (!conversation) {
    conversation = await store.createConversation({
      visitorSessionId,
      externalUserId,
      subject: (message.content ?? "").slice(0, 80),
      metadata,
    });
    created = true;
  } else {
    conversation = await store.bindConversationExternalUser(conversation.id, externalUserId, metadata);
  }
  if (created) await emitWebhook("conversation.created", conversationEventPayload(conversation, { source: "wechat" }));

  const visitorMessage = await store.addMessage({
    conversationId: conversation.id,
    role: "visitor",
    content: message.content ?? "",
    metadata: weChatMessageMetadata(message),
  });
  await emitWebhook("message.created", messageEventPayload(visitorMessage, conversation));

  let updated = await store.getConversation(conversation.id);
  if (!updated) throw new Error("Conversation not found");
  publishConversation(updated);

  let replyText = "消息已收到，客服会尽快处理。";
  if (updated.status === "ai_active") {
    const result = await generateAgentReply(updated);
    updated = await store.getConversation(updated.id);
    if (result.reply) {
      replyText = result.reply.content;
      await emitWebhook("message.created", messageEventPayload(result.reply, updated));
    } else if (result.action === "handoff") {
      replyText = "消息已收到，已为你转接人工客服。";
    }
    if (result.action === "handoff" && updated) {
      await emitWebhook("handoff.started", handoffEventPayload(updated, { reason: result.reason }));
    }
    if (updated) publishConversation(updated);
  }

  return weChatTextReply({
    toUserName: message.fromUserName,
    fromUserName: message.toUserName,
    content: replyText,
  });
}

export async function POST(request: Request) {
  const params = signatureParams(request);
  if (!verifyWeChatSignature(params)) {
    return NextResponse.json({ error: "Invalid WeChat signature" }, { status: 401 });
  }

  const raw = await request.text();
  const message = parseWeChatTextMessage(raw);
  if (!message?.content) {
    return new Response("success", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const reply = await handleTextMessage(message);
  return new Response(reply, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
