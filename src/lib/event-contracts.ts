import type {
  AITrace,
  ConversationWithMessages,
  KnowledgeSearchResult,
  Message,
  ToolInvocationLog,
  WebhookEvent,
} from "./types";

export const webhookEventVersion = "2026-06-19";

export type WebhookEventContract = {
  event: WebhookEvent;
  description: string;
  payload: string[];
};

export const webhookEventContracts: WebhookEventContract[] = [
  {
    event: "conversation.created",
    description: "A conversation was created by the widget or a trusted integration.",
    payload: ["conversation", "metadata"],
  },
  {
    event: "message.created",
    description: "A visitor, AI, human agent, system, or tool message was appended.",
    payload: ["message", "conversation"],
  },
  {
    event: "handoff.started",
    description: "A conversation entered human support through manual takeover, assignment, or auto-handoff.",
    payload: ["conversation", "reason", "actorId"],
  },
  {
    event: "handoff.released",
    description: "A human released the conversation back to AI handling.",
    payload: ["conversation", "actorId"],
  },
  {
    event: "conversation.resolved",
    description: "A human marked the conversation resolved.",
    payload: ["conversation", "actorId"],
  },
  {
    event: "conversation.closed",
    description: "A conversation was closed by an agent or the visitor.",
    payload: ["conversation", "actorId"],
  },
  {
    event: "ai.fallback",
    description: "Agent Runtime returned a fallback response or failed over from provider/tool-call output.",
    payload: ["conversation", "trace", "reason", "replyMessageId"],
  },
  {
    event: "knowledge.hit",
    description: "Agent Runtime retrieved one or more knowledge chunks for a visitor message.",
    payload: ["conversation", "sources", "traceId"],
  },
  {
    event: "tool.invocation",
    description: "A server-side tool invocation completed or failed.",
    payload: ["toolInvocation"],
  },
];

export const webhookEvents = webhookEventContracts.map((contract) => contract.event);

function conversationSummary(conversation: ConversationWithMessages) {
  return {
    id: conversation.id,
    visitorSessionId: conversation.visitorSessionId,
    externalUserId: conversation.externalUserId,
    status: conversation.status,
    subject: conversation.subject,
    metadata: conversation.metadata,
    takenOverById: conversation.takenOverById,
    takenOverAt: conversation.takenOverAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    closedAt: conversation.closedAt,
  };
}

export function conversationEventPayload(
  conversation: ConversationWithMessages,
  metadata?: Record<string, unknown>,
) {
  return {
    conversation: conversationSummary(conversation),
    metadata: metadata ?? {},
  };
}

export function messageEventPayload(message: Message, conversation?: ConversationWithMessages) {
  return {
    message,
    conversation: conversation ? conversationSummary(conversation) : { id: message.conversationId },
  };
}

export function handoffEventPayload(
  conversation: ConversationWithMessages,
  metadata?: { reason?: string; actorId?: string; assignedToId?: string },
) {
  return {
    conversation: conversationSummary(conversation),
    reason: metadata?.reason,
    actorId: metadata?.actorId,
    assignedToId: metadata?.assignedToId,
  };
}

export function aiFallbackEventPayload(input: {
  conversation: ConversationWithMessages;
  trace?: AITrace;
  reason?: string;
  reply?: Message;
}) {
  return {
    conversation: conversationSummary(input.conversation),
    trace: input.trace
      ? {
          id: input.trace.id,
          provider: input.trace.provider,
          model: input.trace.model,
          action: input.trace.action,
          latencyMs: input.trace.latencyMs,
          fallbackReason: input.trace.fallbackReason,
          error: input.trace.error,
          replyMessageId: input.trace.replyMessageId,
          createdAt: input.trace.createdAt,
        }
      : undefined,
    reason: input.reason ?? input.trace?.fallbackReason,
    replyMessageId: input.reply?.id ?? input.trace?.replyMessageId,
  };
}

export function knowledgeHitEventPayload(input: {
  conversation: ConversationWithMessages;
  sources: KnowledgeSearchResult[];
  trace?: AITrace;
}) {
  return {
    conversation: conversationSummary(input.conversation),
    traceId: input.trace?.id,
    sources: input.sources.map((source) => ({
      chunkId: source.id,
      knowledgeBaseId: source.knowledgeBaseId,
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      sourceType: source.sourceType,
      documentId: source.documentId,
      documentTitle: source.documentTitle,
      chunkOrdinal: source.ordinal,
      score: source.score,
    })),
  };
}

export function toolInvocationEventPayload(toolInvocation: ToolInvocationLog) {
  return { toolInvocation };
}

export function webhookEnvelope(event: WebhookEvent, payload: unknown) {
  return {
    event,
    eventVersion: webhookEventVersion,
    occurredAt: new Date().toISOString(),
    payload,
  };
}
