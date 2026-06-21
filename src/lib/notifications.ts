import { sendConfiguredEmail } from "./email";
import { store } from "./store";
import type { ConversationWithMessages, Message, NotificationChannel, NotificationTemplate } from "./types";

type ReminderRecord = {
  messageId: string;
  thresholds: Record<string, { sentAt: string; channels: NotificationChannel[]; ok: boolean; error?: string }>;
};

type NotificationRuntimeState = {
  interval?: ReturnType<typeof setInterval>;
  processing?: boolean;
};

const runtimeKey = "__liveChatNotificationRuntime";

function runtimeState() {
  const globalRecord = globalThis as typeof globalThis & { [runtimeKey]?: NotificationRuntimeState };
  globalRecord[runtimeKey] ??= {};
  return globalRecord[runtimeKey];
}

function snippet(value: string, max = 500) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function channelLabel(conversation: ConversationWithMessages) {
  const channel = conversation.metadata.channel;
  if (typeof channel === "string" && channel.trim()) return channel;
  const [prefix] = conversation.visitorSessionId.split(":");
  return prefix && prefix !== conversation.visitorSessionId ? prefix : "web";
}

function renderTemplate(template: string, conversation: ConversationWithMessages, message: Message, thresholdMinutes?: number) {
  const profile = conversation.customerProfile ?? {};
  const values: Record<string, string> = {
    conversationId: conversation.id,
    status: conversation.status,
    subject: conversation.subject ?? "New conversation",
    customerName: profile.name || profile.email || "Visitor",
    customerEmail: profile.email ?? "",
    channel: channelLabel(conversation),
    message: snippet(message.content),
    messageId: message.id,
    createdAt: message.createdAt,
    thresholdMinutes: thresholdMinutes === undefined ? "" : String(thresholdMinutes),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? "");
}

function enabledChannels(channels: NotificationChannel[], config: Awaited<ReturnType<typeof store.getNotificationConfiguration>>) {
  return channels.filter((channel) => {
    if (channel === "email") return config.emailEnabled && config.emailRecipients.length > 0;
    if (channel === "bark") return config.barkEnabled && config.barkDeviceKeys.length > 0;
    return false;
  });
}

export async function sendBark(serverUrl: string, deviceKey: string, title: string, body: string) {
  const base = serverUrl.replace(/\/+$/, "") || "https://api.day.app";
  const response = await fetch(`${base}/${encodeURIComponent(deviceKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      title,
      body,
      group: "Live Chat",
    }),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Bark notification failed: ${response.status} ${details}`.trim());
  }
}

export async function sendTestNotification() {
  const config = await store.getNotificationConfiguration();
  if (!config.enabled) throw new Error("Notifications are disabled");

  const channels = enabledChannels(["bark", "email"], config);
  if (!channels.length) throw new Error("No notification channels are enabled or configured");

  const title = "Live chat notification test";
  const body = "This is a test notification from AI Agent Live Chat.";
  const errors: string[] = [];

  if (channels.includes("email")) {
    for (const recipient of config.emailRecipients) {
      try {
        await sendConfiguredEmail({ to: recipient, subject: title, text: body });
      } catch (error) {
        errors.push(`email:${recipient}:${error instanceof Error ? error.message : "failed"}`);
      }
    }
  }

  if (channels.includes("bark")) {
    for (const deviceKey of config.barkDeviceKeys) {
      try {
        await sendBark(config.barkServerUrl, deviceKey, title, body);
      } catch (error) {
        errors.push(`bark:${deviceKey.slice(0, 6)}:${error instanceof Error ? error.message : "failed"}`);
      }
    }
  }

  await store.addAuditLog({
    action: "notification.test",
    targetType: "NotificationConfiguration",
    targetId: "global",
    metadata: {
      channels,
      ok: errors.length === 0,
      errors,
    },
  });

  return { ok: errors.length === 0, channels, error: errors.join("; ") };
}

async function deliver(
  kind: "new_message" | "unreplied",
  template: NotificationTemplate,
  conversation: ConversationWithMessages,
  message: Message,
  thresholdMinutes?: number,
) {
  const config = await store.getNotificationConfiguration();
  if (!config.enabled || !template.enabled) return { ok: false, skipped: true, channels: [] as NotificationChannel[] };

  const channels = enabledChannels(template.channels, config);
  if (!channels.length) return { ok: false, skipped: true, channels };

  const title = renderTemplate(template.title, conversation, message, thresholdMinutes);
  const body = renderTemplate(template.body, conversation, message, thresholdMinutes);
  const errors: string[] = [];

  if (channels.includes("email")) {
    for (const recipient of config.emailRecipients) {
      try {
        await sendConfiguredEmail({ to: recipient, subject: title, text: body });
      } catch (error) {
        errors.push(`email:${recipient}:${error instanceof Error ? error.message : "failed"}`);
      }
    }
  }

  if (channels.includes("bark")) {
    for (const deviceKey of config.barkDeviceKeys) {
      try {
        await sendBark(config.barkServerUrl, deviceKey, title, body);
      } catch (error) {
        errors.push(`bark:${deviceKey.slice(0, 6)}:${error instanceof Error ? error.message : "failed"}`);
      }
    }
  }

  await store.addAuditLog({
    action: `notification.${kind}`,
    targetType: "Conversation",
    targetId: conversation.id,
    metadata: {
      messageId: message.id,
      thresholdMinutes,
      channels,
      ok: errors.length === 0,
      errors,
    },
  });

  return { ok: errors.length === 0, channels, error: errors.join("; ") };
}

function hasReplyAfter(conversation: ConversationWithMessages, message: Message) {
  const visitorAt = Date.parse(message.createdAt);
  return conversation.messages.some((item) => {
    if (item.role !== "ai" && item.role !== "human_agent") return false;
    return Date.parse(item.createdAt) > visitorAt;
  });
}

function latestUnrepliedVisitorMessage(conversation: ConversationWithMessages) {
  const visitorMessages = conversation.messages.filter((message) => message.role === "visitor");
  for (let index = visitorMessages.length - 1; index >= 0; index -= 1) {
    const message = visitorMessages[index];
    if (!hasReplyAfter(conversation, message)) return message;
  }
  return undefined;
}

function reminderRecords(conversation: ConversationWithMessages) {
  const notifications = conversation.metadata.notifications;
  if (!notifications || typeof notifications !== "object" || Array.isArray(notifications)) return {};
  const reminders = (notifications as { reminders?: unknown }).reminders;
  return reminders && typeof reminders === "object" && !Array.isArray(reminders)
    ? (reminders as Record<string, ReminderRecord>)
    : {};
}

async function recordReminder(
  conversation: ConversationWithMessages,
  message: Message,
  thresholdMinutes: number,
  result: { ok: boolean; channels: NotificationChannel[]; error?: string },
) {
  const currentNotifications =
    conversation.metadata.notifications &&
    typeof conversation.metadata.notifications === "object" &&
    !Array.isArray(conversation.metadata.notifications)
      ? (conversation.metadata.notifications as Record<string, unknown>)
      : {};
  const reminders = reminderRecords(conversation);
  const messageRecord = reminders[message.id] ?? { messageId: message.id, thresholds: {} };
  messageRecord.thresholds[String(thresholdMinutes)] = {
    sentAt: new Date().toISOString(),
    channels: result.channels,
    ok: result.ok,
    error: result.error,
  };
  await store.mergeConversationMetadata(conversation.id, {
    notifications: {
      ...currentNotifications,
      reminders: {
        ...reminders,
        [message.id]: messageRecord,
      },
    },
  });
}

export async function notifyVisitorMessage(conversation: ConversationWithMessages, message: Message) {
  ensureNotificationScheduler();
  try {
    const config = await store.getNotificationConfiguration();
    return deliver("new_message", config.newMessage, conversation, message);
  } catch (error) {
    await store.addAuditLog({
      action: "notification.new_message.failed",
      targetType: "Conversation",
      targetId: conversation.id,
      metadata: { messageId: message.id, error: error instanceof Error ? error.message : "Notification failed" },
    });
    return { ok: false, channels: [] as NotificationChannel[], error: error instanceof Error ? error.message : "failed" };
  }
}

export async function processUnrepliedReminders() {
  const state = runtimeState();
  if (state.processing) return;
  state.processing = true;
  try {
    const config = await store.getNotificationConfiguration();
    if (!config.enabled || !config.unreplied.enabled) return;
    const now = Date.now();
    const conversations = await store.listConversations();
    for (const conversation of conversations) {
      if (conversation.status === "closed" || conversation.status === "resolved") continue;
      const message = latestUnrepliedVisitorMessage(conversation);
      if (!message) continue;
      const ageMinutes = Math.floor((now - Date.parse(message.createdAt)) / 60000);
      if (ageMinutes < 1) continue;
      const sent = reminderRecords(conversation)[message.id]?.thresholds ?? {};
      for (const threshold of config.unreplied.thresholdsMinutes) {
        if (ageMinutes < threshold || sent[String(threshold)]) continue;
        const result = await deliver("unreplied", config.unreplied, conversation, message, threshold);
        if (!result.skipped) {
          await recordReminder(conversation, message, threshold, result);
        }
      }
    }
  } finally {
    state.processing = false;
  }
}

export function ensureNotificationScheduler() {
  const state = runtimeState();
  if (state.interval) return;
  state.interval = setInterval(() => {
    void processUnrepliedReminders().catch((error) => {
      void store.addAuditLog({
        action: "notification.unreplied.failed",
        targetType: "NotificationConfiguration",
        targetId: "global",
        metadata: { error: error instanceof Error ? error.message : "Notification scan failed" },
      });
    });
  }, 60_000);
}
