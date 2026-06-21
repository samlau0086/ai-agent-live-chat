import type { ConversationWithMessages, MessageAttachment, MessageRole } from "./types";

function roleLabel(role: MessageRole) {
  if (role === "visitor") return "Visitor";
  if (role === "human_agent") return "Agent";
  if (role === "ai") return "AI";
  if (role === "system") return "System";
  if (role === "tool") return "Tool";
  return role;
}

function metadataAttachments(metadata: Record<string, unknown>) {
  const attachments = metadata.attachments;
  if (!Array.isArray(attachments)) return [] as MessageAttachment[];
  return attachments.filter((item): item is MessageAttachment => {
    if (!item || typeof item !== "object") return false;
    const record = item as Partial<MessageAttachment>;
    return Boolean(record.fileName && record.url);
  });
}

export function conversationTranscriptText(
  conversation: ConversationWithMessages,
  options: { includeInternal?: boolean } = {},
) {
  const profile = conversation.customerProfile;
  const lines = [
    "AI Agent Live Chat Transcript",
    `Conversation: ${conversation.id}`,
    `Status: ${conversation.status}`,
    `Created: ${conversation.createdAt}`,
    `Updated: ${conversation.updatedAt}`,
  ];

  if (conversation.subject) lines.push(`Subject: ${conversation.subject}`);
  if (profile?.name) lines.push(`Customer name: ${profile.name}`);
  if (profile?.email) lines.push(`Customer email: ${profile.email}`);
  if (conversation.externalUserId) lines.push(`External user: ${conversation.externalUserId}`);
  lines.push("");

  for (const message of conversation.messages) {
    if (!options.includeInternal && message.metadata?.internalNote) continue;
    lines.push(`[${message.createdAt}] ${roleLabel(message.role)}: ${message.content}`);
    const attachments = metadataAttachments(message.metadata);
    for (const attachment of attachments) {
      lines.push(`  Attachment: ${attachment.fileName} (${attachment.mimeType}, ${attachment.url})`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
