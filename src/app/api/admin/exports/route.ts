import { NextResponse } from "next/server";
import { requireRoleRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { AnalyticsFilters, ConversationStatus, ConversationWithMessages, Message, MessageRole } from "@/lib/types";

const statuses: ConversationStatus[] = ["ai_active", "queued_for_human", "human_active", "resolved", "closed"];
const exportTypes = ["metrics", "conversations", "transcripts"] as const;
const exportFormats = ["json", "csv"] as const;

type ExportType = (typeof exportTypes)[number];
type ExportFormat = (typeof exportFormats)[number];
type ExportRow = Record<string, unknown>;

function optionalParam(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim();
  return value || undefined;
}

function parseFilters(url: URL): AnalyticsFilters {
  const status = optionalParam(url, "status");
  return {
    dateFrom: optionalParam(url, "dateFrom"),
    dateTo: optionalParam(url, "dateTo"),
    agentId: optionalParam(url, "agentId"),
    channel: optionalParam(url, "channel"),
    tag: optionalParam(url, "tag"),
    status: status && statuses.includes(status as ConversationStatus) ? (status as ConversationStatus) : undefined,
    knowledgeBaseId: optionalParam(url, "knowledgeBaseId"),
  };
}

function parseType(url: URL): ExportType {
  const value = optionalParam(url, "type") ?? "metrics";
  return exportTypes.includes(value as ExportType) ? (value as ExportType) : "metrics";
}

function parseFormat(url: URL): ExportFormat {
  const value = optionalParam(url, "format") ?? "json";
  return exportFormats.includes(value as ExportFormat) ? (value as ExportFormat) : "json";
}

function parseLimit(url: URL) {
  const raw = Number(url.searchParams.get("limit") ?? 500);
  if (!Number.isFinite(raw) || raw <= 0) return 500;
  return Math.min(Math.trunc(raw), 5000);
}

function conversationChannel(conversation: ConversationWithMessages) {
  const metadataChannel = conversation.metadata.channel;
  if (typeof metadataChannel === "string" && metadataChannel.trim()) return metadataChannel;
  const [prefix] = conversation.visitorSessionId.split(":");
  return prefix || "web";
}

function numericMetadata(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function satisfactionScore(conversation: ConversationWithMessages) {
  return numericMetadata(conversation.metadata, ["satisfactionScore", "rating", "csat"]);
}

function mentionsKnowledgeBase(value: unknown, knowledgeBaseId: string): boolean {
  if (!value) return false;
  if (typeof value === "string") return value === knowledgeBaseId;
  if (Array.isArray(value)) return value.some((item) => mentionsKnowledgeBase(item, knowledgeBaseId));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.knowledgeBaseId === knowledgeBaseId) return true;
    return Object.values(record).some((item) => mentionsKnowledgeBase(item, knowledgeBaseId));
  }
  return false;
}

function conversationHasKnowledgeBase(conversation: ConversationWithMessages, knowledgeBaseId: string) {
  return conversation.messages.some((message) => mentionsKnowledgeBase(message.metadata, knowledgeBaseId));
}

function conversationMatchesFilters(conversation: ConversationWithMessages, filters: AnalyticsFilters) {
  if (filters.dateFrom && conversation.createdAt < filters.dateFrom) return false;
  if (filters.dateTo && conversation.createdAt > filters.dateTo) return false;
  if (filters.agentId && conversation.takenOverById !== filters.agentId) return false;
  if (filters.channel && conversationChannel(conversation) !== filters.channel) return false;
  if (filters.status && conversation.status !== filters.status) return false;
  if (filters.tag && !conversation.tags?.some((tag) => tag.name === filters.tag)) return false;
  if (filters.knowledgeBaseId && !conversationHasKnowledgeBase(conversation, filters.knowledgeBaseId)) return false;
  return true;
}

function roleLabel(role: MessageRole) {
  if (role === "visitor") return "Visitor";
  if (role === "human_agent") return "Agent";
  if (role === "ai") return "AI";
  if (role === "system") return "System";
  if (role === "tool") return "Tool";
  return role;
}

function publicMessages(messages: Message[], includeInternal: boolean) {
  return includeInternal ? messages : messages.filter((message) => !message.metadata?.internalNote);
}

function transcriptText(conversation: ConversationWithMessages, includeInternal: boolean) {
  const messages = publicMessages(conversation.messages, includeInternal);
  return [
    "AI Agent Live Chat Transcript",
    `Conversation: ${conversation.id}`,
    `Status: ${conversation.status}`,
    `Channel: ${conversationChannel(conversation)}`,
    `Created: ${conversation.createdAt}`,
    "",
    ...messages.map((message) => `[${message.createdAt}] ${roleLabel(message.role)}: ${message.content}`),
    "",
  ].join("\n");
}

function conversationRows(conversations: ConversationWithMessages[]): ExportRow[] {
  return conversations.map((conversation) => {
    const messageCounts = conversation.messages.reduce(
      (counts, message) => {
        counts.total += 1;
        counts[message.role] += 1;
        return counts;
      },
      { total: 0, visitor: 0, ai: 0, human_agent: 0, system: 0, tool: 0 } satisfies Record<MessageRole | "total", number>,
    );

    return {
      id: conversation.id,
      status: conversation.status,
      subject: conversation.subject,
      channel: conversationChannel(conversation),
      externalUserId: conversation.externalUserId,
      takenOverById: conversation.takenOverById,
      takenOverByUsername: conversation.takenOverBy?.username,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      closedAt: conversation.closedAt,
      tags: conversation.tags?.map((tag) => tag.name).join(", "),
      satisfactionScore: satisfactionScore(conversation),
      messageCount: messageCounts.total,
      visitorMessages: messageCounts.visitor,
      aiMessages: messageCounts.ai,
      humanMessages: messageCounts.human_agent,
      systemMessages: messageCounts.system,
      toolMessages: messageCounts.tool,
    };
  });
}

function transcriptRows(conversations: ConversationWithMessages[], includeInternal: boolean): ExportRow[] {
  return conversations.flatMap((conversation) =>
    publicMessages(conversation.messages, includeInternal).map((message) => ({
      conversationId: conversation.id,
      conversationStatus: conversation.status,
      channel: conversationChannel(conversation),
      messageId: message.id,
      role: message.role,
      agentId: message.agentId,
      content: message.content,
      metadata: message.metadata,
      createdAt: message.createdAt,
    })),
  );
}

function csvEscape(value: unknown) {
  const text =
    value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: ExportRow[]) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  return [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
}

function filename(type: ExportType, format: ExportFormat) {
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return `live-chat-${type}-${stamp}.${format}`;
}

function jsonDownload(data: unknown, type: ExportType) {
  return NextResponse.json(data, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename(type, "json")}"`,
    },
  });
}

function csvDownload(rows: ExportRow[], type: ExportType) {
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename(type, "csv")}"`,
    },
  });
}

async function loadExportConversations(url: URL, filters: AnalyticsFilters) {
  const conversationId = optionalParam(url, "conversationId");
  if (conversationId) {
    const conversation = await store.getConversation(conversationId);
    return conversation && conversationMatchesFilters(conversation, filters) ? [conversation] : [];
  }

  const limit = parseLimit(url);
  const conversations = await store.listConversations();
  return conversations.filter((conversation) => conversationMatchesFilters(conversation, filters)).slice(0, limit);
}

export async function GET(request: Request) {
  const auth = await requireRoleRequest(["admin", "viewer"], "admin.exports.read");
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const type = parseType(url);
  const format = parseFormat(url);
  const filters = parseFilters(url);
  const exportedAt = new Date().toISOString();

  if (type === "metrics") {
    const metrics = await store.getMetrics(filters);
    await store.addAuditLog({
      actorId: auth.user.id,
      action: "admin.export.created",
      targetType: "Analytics",
      metadata: { type, format, filters },
    });

    if (format === "csv") {
      return csvDownload([{ exportedAt, ...metrics }], type);
    }
    return jsonDownload({ exportedAt, type, filters, metrics }, type);
  }

  const conversations = await loadExportConversations(url, filters);
  const includeInternal = url.searchParams.get("includeInternal") === "1";

  await store.addAuditLog({
    actorId: auth.user.id,
    action: "admin.export.created",
    targetType: type === "conversations" ? "Conversation" : "Transcript",
    metadata: {
      type,
      format,
      filters,
      count: conversations.length,
      includeInternal,
      conversationId: optionalParam(url, "conversationId"),
    },
  });

  if (type === "conversations") {
    const rows = conversationRows(conversations);
    if (format === "csv") return csvDownload(rows, type);
    return jsonDownload({ exportedAt, type, filters, conversations: rows }, type);
  }

  if (format === "csv") return csvDownload(transcriptRows(conversations, includeInternal), type);

  return jsonDownload(
    {
      exportedAt,
      type,
      filters,
      includeInternal,
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        status: conversation.status,
        channel: conversationChannel(conversation),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        transcript: transcriptText(conversation, includeInternal),
        messages: publicMessages(conversation.messages, includeInternal),
      })),
    },
    type,
  );
}
