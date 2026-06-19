import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-runtime";
import {
  discordConversationMetadata,
  discordInteractionContent,
  discordInteractionResponse,
  discordMessageMetadata,
  discordUserId,
  discordVisitorSessionId,
  verifyDiscordRequest,
  type DiscordInteraction,
} from "@/lib/channel-adapters";
import { conversationEventPayload, handoffEventPayload, messageEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

const interactionTypePing = 1;
const interactionTypeApplicationCommand = 2;

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyDiscordRequest(raw, request.headers)) {
    return NextResponse.json({ error: "Invalid Discord signature" }, { status: 401 });
  }

  let body: DiscordInteraction;
  try {
    body = JSON.parse(raw || "{}") as DiscordInteraction;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.type === interactionTypePing) {
    return NextResponse.json({ type: 1 });
  }
  if (body.type !== interactionTypeApplicationCommand) {
    return NextResponse.json(discordInteractionResponse("This Discord interaction type is not supported yet."));
  }

  const applicationId = String(body.application_id ?? "").trim();
  const channelId = String(body.channel_id ?? "").trim();
  const userId = discordUserId(body);
  const content = discordInteractionContent(body).trim();
  if (!applicationId || !channelId || !userId) {
    return NextResponse.json(discordInteractionResponse("Discord user or channel context is missing."));
  }
  if (!content) {
    return NextResponse.json(discordInteractionResponse("Send a message option with your support question."));
  }

  const visitorSessionId = discordVisitorSessionId({ applicationId, channelId, userId });
  const externalUserId = `discord:${applicationId}:${userId}`;
  const metadata = discordConversationMetadata({
    applicationId,
    guildId: body.guild_id,
    channelId,
    userId,
    interactionId: body.id,
    commandName: body.data?.name,
  });
  let conversation = await store.getConversationByVisitorSession(visitorSessionId);
  if (conversation?.messages.some((message) => message.metadata?.discordInteractionId === body.id)) {
    return NextResponse.json(discordInteractionResponse("This Discord interaction was already processed."));
  }

  let created = false;
  if (!conversation) {
    conversation = await store.createConversation({
      visitorSessionId,
      externalUserId,
      subject: content.slice(0, 80),
      metadata,
    });
    created = true;
  } else {
    conversation = await store.bindConversationExternalUser(conversation.id, externalUserId, metadata);
  }
  if (created) await emitWebhook("conversation.created", conversationEventPayload(conversation, { source: "discord" }));

  const visitorMessage = await store.addMessage({
    conversationId: conversation.id,
    role: "visitor",
    content,
    metadata: discordMessageMetadata({
      applicationId,
      guildId: body.guild_id,
      channelId,
      userId,
      interactionId: body.id,
      commandName: body.data?.name,
    }),
  });
  await emitWebhook("message.created", messageEventPayload(visitorMessage, conversation));

  let updated = await store.getConversation(conversation.id);
  if (!updated) return NextResponse.json(discordInteractionResponse("Conversation could not be loaded."));
  publishConversation(updated);

  let responseText = "Your message was received. A human agent can continue from the Live Chat console.";
  if (updated.status === "ai_active") {
    const result = await generateAgentReply(updated);
    updated = await store.getConversation(updated.id);
    if (result.reply) {
      responseText = result.reply.content;
      await emitWebhook("message.created", messageEventPayload(result.reply, updated));
    } else if (result.action === "handoff") {
      responseText = "Your message was received and queued for a human agent.";
    }
    if (result.action === "handoff" && updated) {
      await emitWebhook("handoff.started", handoffEventPayload(updated, { reason: result.reason }));
    }
    if (updated) publishConversation(updated);
  }

  return NextResponse.json(discordInteractionResponse(responseText));
}
