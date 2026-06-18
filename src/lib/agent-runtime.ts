import { getAIProvider } from "./ai";
import { publishConversation } from "./events";
import { store } from "./store";
import { tools } from "./tools";
import type { AIConfiguration, ConversationWithMessages, KnowledgeSearchResult, Message } from "./types";

export type AgentRuntimeResult = {
  action: "replied" | "handoff" | "skipped";
  reply?: Message;
  knowledgeContext: KnowledgeSearchResult[];
  reason?: string;
};

function includesAny(input: string, patterns: string[]) {
  const normalized = input.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function metadataSignalsVip(metadata: Record<string, unknown>, keys: string[]) {
  const flattened = Object.entries(metadata).map(([key, value]) => `${key}:${String(value)}`.toLowerCase());
  return keys.some((key) => flattened.some((entry) => entry.includes(key.toLowerCase())));
}

function shouldAutoHandoff(conversation: ConversationWithMessages, aiConfig: AIConfiguration) {
  if (!aiConfig.autoHandoff.enabled) return undefined;
  const latestVisitorMessage = [...conversation.messages].reverse().find((message) => message.role === "visitor");
  const content = latestVisitorMessage?.content ?? "";

  if (includesAny(content, aiConfig.autoHandoff.userRequestPatterns)) return "user_requested_human";
  if (includesAny(content, aiConfig.autoHandoff.sensitiveKeywords)) return "sensitive_keyword";
  if (metadataSignalsVip(conversation.metadata, aiConfig.autoHandoff.vipMetadataKeys)) return "vip_customer";
  return undefined;
}

function recentMessages(messages: Message[], maxContextMessages: number) {
  return messages.slice(Math.max(messages.length - maxContextMessages, 0));
}

export async function retrieveKnowledge(input: {
  query: string;
  knowledgeBaseIds?: string[];
  topK?: number;
}) {
  return store.searchKnowledge(input);
}

export async function generateAgentReply(conversation: ConversationWithMessages): Promise<AgentRuntimeResult> {
  if (conversation.status !== "ai_active") {
    return { action: "skipped", knowledgeContext: [], reason: `status:${conversation.status}` };
  }

  const aiConfig = await store.getAIConfiguration();
  const handoffReason = shouldAutoHandoff(conversation, aiConfig);
  if (handoffReason) {
    await store.setConversationStatus(conversation.id, "queued_for_human");
    await store.addMessage({
      conversationId: conversation.id,
      role: "system",
      content: `Conversation queued for human support: ${handoffReason}.`,
      metadata: { handoffReason },
    });
    const updated = await store.getConversation(conversation.id);
    if (updated) publishConversation(updated);
    return { action: "handoff", knowledgeContext: [], reason: handoffReason };
  }

  const latestVisitorMessage = [...conversation.messages].reverse().find((message) => message.role === "visitor");
  const knowledgeContext =
    aiConfig.enableKnowledgeBase && latestVisitorMessage
      ? await retrieveKnowledge({
          query: latestVisitorMessage.content,
          knowledgeBaseIds: aiConfig.knowledgeBaseIds,
          topK: 5,
        })
      : [];

  const provider = getAIProvider(aiConfig);
  const replyText = await provider.generateReply({
    conversation,
    messages: recentMessages(conversation.messages, aiConfig.maxContextMessages),
    tools: aiConfig.enableTools ? tools : [],
    aiConfig,
    knowledgeContext,
  });

  const reply = await store.addMessage({
    conversationId: conversation.id,
    role: "ai",
    content: replyText || aiConfig.fallbackMessage,
    metadata: {
      provider: aiConfig.provider,
      model: aiConfig.model,
      knowledgeSources: knowledgeContext.map((result: KnowledgeSearchResult) => ({
        documentId: result.documentId,
        documentTitle: result.documentTitle,
        score: result.score,
      })),
    },
  });
  return { action: "replied", reply, knowledgeContext };
}
