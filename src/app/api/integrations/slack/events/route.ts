import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-runtime";
import {
  postSlackMessage,
  slackConversationMetadata,
  slackMessageMetadata,
  slackVisitorSessionId,
  verifySlackRequest,
  type SlackEventEnvelope,
} from "@/lib/channel-adapters";
import { conversationEventPayload, handoffEventPayload, messageEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { notifyVisitorMessage } from "@/lib/notifications";
import { store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySlackRequest(raw, request.headers)) {
    return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  let body: SlackEventEnvelope;
  try {
    body = JSON.parse(raw || "{}") as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.type === "url_verification") {
    return new Response(body.challenge ?? "", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (body.type !== "event_callback") {
    return NextResponse.json({ ok: true, ignored: true, reason: "unsupported_envelope_type" });
  }

  const event = body.event;
  if (
    !event ||
    event.type !== "message" ||
    event.subtype ||
    event.bot_id ||
    !event.text ||
    !event.channel ||
    !event.ts ||
    !body.team_id
  ) {
    return NextResponse.json({ ok: true, ignored: true, reason: "unsupported_event" });
  }

  const content = event.text.trim();
  if (!content) return NextResponse.json({ ok: true, ignored: true, reason: "empty_message" });

  const threadTs = event.thread_ts ?? event.ts;
  const visitorSessionId = slackVisitorSessionId(body.team_id, event.channel, threadTs);
  const externalUserId = event.user ? `slack:${body.team_id}:${event.user}` : undefined;
  let conversation = await store.getConversationByVisitorSession(visitorSessionId);
  let created = false;
  if (conversation?.messages.some((message) => message.metadata?.slackEventId === body.event_id)) {
    return NextResponse.json({ ok: true, duplicate: true, conversationId: conversation.id });
  }

  if (!conversation) {
    conversation = await store.createConversation({
      visitorSessionId,
      externalUserId,
      subject: content.slice(0, 80),
      metadata: slackConversationMetadata({
        teamId: body.team_id,
        apiAppId: body.api_app_id,
        channelId: event.channel,
        threadTs,
        eventId: body.event_id,
      }),
    });
    created = true;
  } else {
    conversation = externalUserId
      ? await store.bindConversationExternalUser(
          conversation.id,
          externalUserId,
          slackConversationMetadata({
            teamId: body.team_id,
            apiAppId: body.api_app_id,
            channelId: event.channel,
            threadTs,
            eventId: body.event_id,
          }),
        )
      : await store.mergeConversationMetadata(
          conversation.id,
          slackConversationMetadata({
            teamId: body.team_id,
            apiAppId: body.api_app_id,
            channelId: event.channel,
            threadTs,
            eventId: body.event_id,
          }),
        );
  }

  if (created) await emitWebhook("conversation.created", conversationEventPayload(conversation, { source: "slack" }));

  const visitorMessage = await store.addMessage({
    conversationId: conversation.id,
    role: "visitor",
    content,
    metadata: slackMessageMetadata({
      teamId: body.team_id,
      channelId: event.channel,
      threadTs,
      messageTs: event.ts,
      userId: event.user,
      eventId: body.event_id,
    }),
  });
  await emitWebhook("message.created", messageEventPayload(visitorMessage, conversation));

  let updated = await store.getConversation(conversation.id);
  if (!updated) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  publishConversation(updated);
  void notifyVisitorMessage(updated, visitorMessage);

  let slackDelivery:
    | Awaited<ReturnType<typeof postSlackMessage>>
    | { status: "skipped"; reason: "ai_not_active" | "no_ai_reply" }
    | undefined;
  if (updated.status === "ai_active") {
    const result = await generateAgentReply(updated);
    updated = await store.getConversation(updated.id);
    if (result.reply) {
      await emitWebhook("message.created", messageEventPayload(result.reply, updated));
      slackDelivery = await postSlackMessage({
        channelId: event.channel,
        threadTs,
        text: result.reply.content,
      });
    } else {
      slackDelivery = { status: "skipped", reason: "no_ai_reply" };
    }
    if (result.action === "handoff" && updated) {
      await emitWebhook("handoff.started", handoffEventPayload(updated, { reason: result.reason }));
    }
    if (updated) publishConversation(updated);
  } else {
    slackDelivery = { status: "skipped", reason: "ai_not_active" };
  }

  return NextResponse.json({
    ok: true,
    adapter: "slack",
    created,
    conversationId: updated?.id ?? conversation.id,
    messageId: visitorMessage.id,
    slackDelivery,
  });
}
