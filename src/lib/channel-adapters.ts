import { hmac, safeEqual, sha1Hex, verifyEd25519Hex } from "./crypto";
import type { ConversationWithMessages, CustomerProfile } from "./types";

export type ChannelAdapterName = "rest" | "slack" | "discord" | "whatsapp" | "wechat";
export type ChannelAdapterStatus = "implemented" | "planned";

export type ChannelAdapterDefinition = {
  name: ChannelAdapterName;
  label: string;
  status: ChannelAdapterStatus;
  inbound: boolean;
  outbound: boolean;
  description: string;
};

export type RestIncomingMessageInput = {
  conversationId?: string;
  externalConversationId?: string;
  externalUserId?: string;
  subject?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  messageMetadata?: Record<string, unknown>;
  profile?: CustomerProfile;
};

export const channelAdapters: ChannelAdapterDefinition[] = [
  {
    name: "rest",
    label: "REST API",
    status: "implemented",
    inbound: true,
    outbound: true,
    description: "Signed REST endpoints for external systems to create/reuse conversations and append visitor messages.",
  },
  {
    name: "slack",
    label: "Slack",
    status: "implemented",
    inbound: true,
    outbound: Boolean(process.env.SLACK_BOT_TOKEN),
    description: "Slack Events API inbound adapter with optional AI reply delivery through chat.postMessage.",
  },
  {
    name: "discord",
    label: "Discord",
    status: "implemented",
    inbound: true,
    outbound: true,
    description: "Discord Interactions adapter for slash-command style inbound messages and immediate AI responses.",
  },
  {
    name: "whatsapp",
    label: "WhatsApp",
    status: "implemented",
    inbound: true,
    outbound: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    description: "WhatsApp Cloud API webhook adapter with optional AI reply delivery through Graph API messages.",
  },
  {
    name: "wechat",
    label: "WeChat",
    status: "implemented",
    inbound: true,
    outbound: true,
    description: "WeChat Official Account plaintext webhook adapter with synchronous text replies.",
  },
];

export function restVisitorSessionId(externalConversationId: string) {
  return `rest:${externalConversationId}`;
}

export function restConversationMetadata(input: RestIncomingMessageInput) {
  const metadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
    channel: "rest",
  };
  if (input.externalConversationId) metadata.externalConversationId = input.externalConversationId;
  if (input.profile) metadata.customerProfile = input.profile;
  return metadata;
}

export function restMessageMetadata(input: RestIncomingMessageInput) {
  const metadata: Record<string, unknown> = {
    ...(input.messageMetadata ?? {}),
    source: "channel_adapter",
    channel: "rest",
  };
  if (input.externalConversationId) metadata.externalConversationId = input.externalConversationId;
  if (input.externalUserId) metadata.externalUserId = input.externalUserId;
  return metadata;
}

export function summarizeAdapterConversation(conversation: ConversationWithMessages) {
  return {
    id: conversation.id,
    externalUserId: conversation.externalUserId,
    status: conversation.status,
    subject: conversation.subject,
    metadata: conversation.metadata,
    messageCount: conversation.messages.length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export type SlackEventEnvelope = {
  type?: string;
  challenge?: string;
  team_id?: string;
  api_app_id?: string;
  event_id?: string;
  event_time?: number;
  event?: {
    type?: string;
    subtype?: string;
    text?: string;
    user?: string;
    bot_id?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  };
};

export function verifySlackRequest(raw: string, headers: Headers) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;
  const timestamp = headers.get("x-slack-request-timestamp") ?? "";
  const signature = headers.get("x-slack-signature") ?? "";
  const timestampSeconds = Number(timestamp);
  if (!timestampSeconds || Math.abs(Date.now() / 1000 - timestampSeconds) > 60 * 5) return false;
  const expected = `v0=${hmac(`v0:${timestamp}:${raw}`, secret)}`;
  return safeEqual(expected, signature);
}

export function slackVisitorSessionId(teamId: string, channelId: string, threadTs: string) {
  return `slack:${teamId}:${channelId}:${threadTs}`;
}

export function slackExternalConversationId(teamId: string, channelId: string, threadTs: string) {
  return `${teamId}:${channelId}:${threadTs}`;
}

export function slackConversationMetadata(input: {
  teamId: string;
  apiAppId?: string;
  channelId: string;
  threadTs: string;
  eventId?: string;
}) {
  return {
    channel: "slack",
    slackTeamId: input.teamId,
    slackApiAppId: input.apiAppId,
    slackChannelId: input.channelId,
    slackThreadTs: input.threadTs,
    externalConversationId: slackExternalConversationId(input.teamId, input.channelId, input.threadTs),
    latestSlackEventId: input.eventId,
  };
}

export function slackMessageMetadata(input: {
  teamId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId?: string;
  eventId?: string;
}) {
  return {
    source: "channel_adapter",
    channel: "slack",
    slackTeamId: input.teamId,
    slackChannelId: input.channelId,
    slackThreadTs: input.threadTs,
    slackMessageTs: input.messageTs,
    slackUserId: input.userId,
    slackEventId: input.eventId,
  };
}

export async function postSlackMessage(input: { channelId: string; threadTs: string; text: string }) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return { status: "skipped" as const, reason: "missing_slack_bot_token" };
  }
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channelId,
      thread_ts: input.threadTs,
      text: input.text,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; ts?: string };
  if (!response.ok || !body.ok) {
    return {
      status: "failed" as const,
      error: body.error ?? `HTTP ${response.status}`,
    };
  }
  return { status: "sent" as const, ts: body.ts };
}

export type DiscordInteractionOption = {
  name?: string;
  type?: number;
  value?: string | number | boolean;
  options?: DiscordInteractionOption[];
};

export type DiscordInteraction = {
  id?: string;
  application_id?: string;
  type?: number;
  token?: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id?: string; username?: string } };
  user?: { id?: string; username?: string };
  data?: {
    id?: string;
    name?: string;
    options?: DiscordInteractionOption[];
  };
};

export function verifyDiscordRequest(raw: string, headers: Headers) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) return false;
  const signature = headers.get("x-signature-ed25519") ?? "";
  const timestamp = headers.get("x-signature-timestamp") ?? "";
  if (!signature || !timestamp) return false;
  return verifyEd25519Hex(`${timestamp}${raw}`, signature, publicKey);
}

export function discordUserId(interaction: DiscordInteraction) {
  return interaction.member?.user?.id ?? interaction.user?.id;
}

export function discordVisitorSessionId(input: { applicationId: string; channelId: string; userId: string }) {
  return `discord:${input.applicationId}:${input.channelId}:${input.userId}`;
}

export function discordExternalConversationId(input: { applicationId: string; channelId: string; userId: string }) {
  return `${input.applicationId}:${input.channelId}:${input.userId}`;
}

export function discordConversationMetadata(input: {
  applicationId: string;
  guildId?: string;
  channelId: string;
  userId: string;
  interactionId?: string;
  commandName?: string;
}) {
  return {
    channel: "discord",
    discordApplicationId: input.applicationId,
    discordGuildId: input.guildId,
    discordChannelId: input.channelId,
    discordUserId: input.userId,
    discordCommandName: input.commandName,
    latestDiscordInteractionId: input.interactionId,
    externalConversationId: discordExternalConversationId(input),
  };
}

export function discordMessageMetadata(input: {
  applicationId: string;
  guildId?: string;
  channelId: string;
  userId: string;
  interactionId?: string;
  commandName?: string;
}) {
  return {
    source: "channel_adapter",
    channel: "discord",
    discordApplicationId: input.applicationId,
    discordGuildId: input.guildId,
    discordChannelId: input.channelId,
    discordUserId: input.userId,
    discordInteractionId: input.interactionId,
    discordCommandName: input.commandName,
  };
}

function flattenDiscordOptions(options: DiscordInteractionOption[] = []): string[] {
  return options.flatMap((option) => {
    if (typeof option.value === "string" && option.value.trim()) return [option.value.trim()];
    return flattenDiscordOptions(option.options);
  });
}

export function discordInteractionContent(interaction: DiscordInteraction) {
  return flattenDiscordOptions(interaction.data?.options)[0] ?? "";
}

export function discordInteractionResponse(content: string) {
  return {
    type: 4,
    data: {
      content: content.slice(0, 1900),
      allowed_mentions: { parse: [] },
    },
  };
}

export type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
};

export type WhatsAppIncomingTextMessage = {
  entryId?: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  from: string;
  messageId: string;
  timestamp?: string;
  text: string;
  contactName?: string;
};

export function verifyWhatsAppWebhook(raw: string, headers: Headers) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  const signature = headers.get("x-hub-signature-256") ?? "";
  if (!signature.startsWith("sha256=")) return false;
  return safeEqual(`sha256=${hmac(raw, secret)}`, signature);
}

export function extractWhatsAppTextMessages(payload: WhatsAppWebhookPayload) {
  const messages: WhatsAppIncomingTextMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const message of value.messages ?? []) {
        if (message.type !== "text" || !message.text?.body || !message.from || !message.id) continue;
        const contact = value.contacts?.find((item) => item.wa_id === message.from) ?? value.contacts?.[0];
        messages.push({
          entryId: entry.id,
          phoneNumberId,
          displayPhoneNumber: value.metadata?.display_phone_number,
          from: message.from,
          messageId: message.id,
          timestamp: message.timestamp,
          text: message.text.body,
          contactName: contact?.profile?.name,
        });
      }
    }
  }
  return messages;
}

export function whatsAppVisitorSessionId(input: { phoneNumberId: string; from: string }) {
  return `whatsapp:${input.phoneNumberId}:${input.from}`;
}

export function whatsAppExternalConversationId(input: { phoneNumberId: string; from: string }) {
  return `${input.phoneNumberId}:${input.from}`;
}

export function whatsAppConversationMetadata(input: WhatsAppIncomingTextMessage) {
  return {
    channel: "whatsapp",
    whatsAppPhoneNumberId: input.phoneNumberId,
    whatsAppDisplayPhoneNumber: input.displayPhoneNumber,
    whatsAppFrom: input.from,
    whatsAppContactName: input.contactName,
    latestWhatsAppMessageId: input.messageId,
    externalConversationId: whatsAppExternalConversationId(input),
    customerProfile: input.contactName ? { name: input.contactName, externalId: input.from } : undefined,
  };
}

export function whatsAppMessageMetadata(input: WhatsAppIncomingTextMessage) {
  return {
    source: "channel_adapter",
    channel: "whatsapp",
    whatsAppPhoneNumberId: input.phoneNumberId,
    whatsAppDisplayPhoneNumber: input.displayPhoneNumber,
    whatsAppFrom: input.from,
    whatsAppMessageId: input.messageId,
    whatsAppTimestamp: input.timestamp,
  };
}

export async function postWhatsAppTextMessage(input: { phoneNumberId: string; to: string; text: string }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    return { status: "skipped" as const, reason: "missing_whatsapp_access_token" };
  }
  const version = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${input.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: {
        preview_url: false,
        body: input.text.slice(0, 4000),
      },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    return {
      status: "failed" as const,
      error: body.error?.message ?? `HTTP ${response.status}`,
    };
  }
  return { status: "sent" as const, messageId: body.messages?.[0]?.id };
}

export type WeChatTextMessage = {
  toUserName: string;
  fromUserName: string;
  createTime?: string;
  msgType: string;
  content?: string;
  msgId?: string;
};

export function verifyWeChatSignature(input: {
  signature?: string | null;
  timestamp?: string | null;
  nonce?: string | null;
}) {
  const token = process.env.WECHAT_TOKEN;
  if (!token || !input.signature || !input.timestamp || !input.nonce) return false;
  const expected = sha1Hex([token, input.timestamp, input.nonce].sort().join(""));
  return safeEqual(expected, input.signature);
}

function xmlValue(xml: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tagName}>`);
  const match = xml.match(pattern);
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

export function parseWeChatTextMessage(xml: string): WeChatTextMessage | undefined {
  const message: WeChatTextMessage = {
    toUserName: xmlValue(xml, "ToUserName"),
    fromUserName: xmlValue(xml, "FromUserName"),
    createTime: xmlValue(xml, "CreateTime"),
    msgType: xmlValue(xml, "MsgType"),
    content: xmlValue(xml, "Content"),
    msgId: xmlValue(xml, "MsgId"),
  };
  if (!message.toUserName || !message.fromUserName || message.msgType !== "text") return undefined;
  return message;
}

export function weChatVisitorSessionId(input: { toUserName: string; fromUserName: string }) {
  return `wechat:${input.toUserName}:${input.fromUserName}`;
}

export function weChatExternalConversationId(input: { toUserName: string; fromUserName: string }) {
  return `${input.toUserName}:${input.fromUserName}`;
}

export function weChatConversationMetadata(input: WeChatTextMessage) {
  return {
    channel: "wechat",
    weChatToUserName: input.toUserName,
    weChatFromUserName: input.fromUserName,
    latestWeChatMsgId: input.msgId,
    externalConversationId: weChatExternalConversationId(input),
  };
}

export function weChatMessageMetadata(input: WeChatTextMessage) {
  return {
    source: "channel_adapter",
    channel: "wechat",
    weChatToUserName: input.toUserName,
    weChatFromUserName: input.fromUserName,
    weChatCreateTime: input.createTime,
    weChatMsgId: input.msgId,
  };
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function weChatTextReply(input: { toUserName: string; fromUserName: string; content: string }) {
  const createdAt = Math.floor(Date.now() / 1000);
  return `<xml><ToUserName><![CDATA[${input.toUserName}]]></ToUserName><FromUserName><![CDATA[${input.fromUserName}]]></FromUserName><CreateTime>${createdAt}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content>${escapeXml(input.content.slice(0, 2000))}</Content></xml>`;
}
