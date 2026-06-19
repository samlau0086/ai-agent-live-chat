import { getAIProvider, type AIProviderMessage, type AIProviderPrompt } from "./ai";
import { publishConversation } from "./events";
import { aiFallbackEventPayload, knowledgeHitEventPayload } from "./event-contracts";
import { store } from "./store";
import { listConfiguredTools, type AgentTool } from "./tools";
import type { AIConfiguration, AITrace, ConversationWithMessages, KnowledgeSearchOptions, KnowledgeSearchResult, Message } from "./types";
import { emitWebhook } from "./webhooks";

export type AgentRuntimeResult = {
  action: "replied" | "handoff" | "skipped";
  reply?: Message;
  knowledgeContext: KnowledgeSearchResult[];
  reason?: string;
  trace?: AITrace;
  replyText?: string;
  promptSummary: {
    systemPromptLength: number;
    selectedMessageCount: number;
    knowledgeSourceCount: number;
    toolCount: number;
    maxContextMessages: number;
    knowledgeEnabled: boolean;
    toolsEnabled: boolean;
  };
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

function countConsecutiveAIFailuresBeforeLatestVisitor(messages: Message[]) {
  const latestVisitorIndex = messages.map((message) => message.role).lastIndexOf("visitor");
  if (latestVisitorIndex <= 0) return 0;

  let failures = 0;
  for (let index = latestVisitorIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "ai") continue;
    if (message.metadata?.fallbackReason || message.metadata?.error) {
      failures += 1;
      continue;
    }
    break;
  }
  return failures;
}

function repeatedAIFailureHandoffReason(conversation: ConversationWithMessages, aiConfig: AIConfiguration) {
  if (!aiConfig.autoHandoff.enabled) return undefined;
  const threshold = Math.max(0, aiConfig.autoHandoff.aiFailureThreshold);
  if (threshold <= 0) return undefined;
  return countConsecutiveAIFailuresBeforeLatestVisitor(conversation.messages) >= threshold
    ? "repeated_ai_failure"
    : undefined;
}

function lowConfidenceKnowledgeHandoffReason(knowledgeContext: KnowledgeSearchResult[], aiConfig: AIConfiguration) {
  if (!aiConfig.autoHandoff.enabled || !aiConfig.enableKnowledgeBase) return undefined;
  const threshold = Math.max(0, aiConfig.autoHandoff.lowConfidenceKnowledgeScoreThreshold);
  if (threshold <= 0 || knowledgeContext.length === 0) return undefined;
  const topScore = knowledgeContext[0]?.score ?? 0;
  return topScore < threshold ? "low_confidence_knowledge" : undefined;
}

function recentMessages(messages: Message[], maxContextMessages: number) {
  return messages.slice(Math.max(messages.length - maxContextMessages, 0));
}

function configSnapshot(aiConfig: AIConfiguration) {
  return {
    provider: aiConfig.provider,
    model: aiConfig.model,
    temperature: aiConfig.temperature,
    maxContextMessages: aiConfig.maxContextMessages,
    enableKnowledgeBase: aiConfig.enableKnowledgeBase,
    enableTools: aiConfig.enableTools,
    knowledgeBaseIds: aiConfig.knowledgeBaseIds,
    noAnswerStrategy: aiConfig.noAnswerStrategy,
    autoHandoff: aiConfig.autoHandoff,
    systemPromptLength: aiConfig.systemPrompt.length,
    fallbackMessageLength: aiConfig.fallbackMessage.length,
  };
}

function traceKnowledgeSources(knowledgeContext: KnowledgeSearchResult[]) {
  return knowledgeContext.map((result) => ({
    chunkId: result.id,
    knowledgeBaseId: result.knowledgeBaseId,
    sourceId: result.sourceId,
    sourceName: result.sourceName,
    sourceType: result.sourceType,
    documentId: result.documentId,
    documentTitle: result.documentTitle,
    chunkOrdinal: result.ordinal,
    score: result.score,
  }));
}

function traceMessages(messages: Message[]): AITrace["selectedMessages"] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }));
}

function knowledgePrompt(knowledgeContext: KnowledgeSearchResult[]) {
  return knowledgeContext.length
    ? `\n\nKnowledge context:\n${knowledgeContext
        .map((result, index) => `[${index + 1}] ${result.documentTitle}\n${result.content}`)
        .join("\n\n")}`
    : "";
}

function toolsPrompt(enabledTools: AgentTool[]) {
  return enabledTools.length
    ? `\n\nAvailable tools:\n${enabledTools
        .map((tool) => `- ${tool.name}: ${tool.description}`)
        .join("\n")}\nTool execution is currently server-controlled; do not claim that a tool was called unless tool output is present.`
    : "";
}

function noAnswerPrompt(
  aiConfig: AIConfiguration,
  latestVisitorMessage: Message | undefined,
  knowledgeContext: KnowledgeSearchResult[],
) {
  if (!aiConfig.enableKnowledgeBase || !latestVisitorMessage) return "";
  if (knowledgeContext.length > 0 || aiConfig.noAnswerStrategy !== "continue") return "";
  return "\n\nNo relevant knowledge was found for the latest visitor message. Continue only with a clear uncertainty caveat, avoid source-specific claims, and offer human support when appropriate.";
}

function noAnswerReason(
  aiConfig: AIConfiguration,
  latestVisitorMessage: Message | undefined,
  knowledgeContext: KnowledgeSearchResult[],
) {
  if (!aiConfig.enableKnowledgeBase || !latestVisitorMessage) return undefined;
  if (knowledgeContext.length > 0 || aiConfig.noAnswerStrategy === "continue") return undefined;
  return `no_knowledge_${aiConfig.noAnswerStrategy}`;
}

function providerRole(message: Message): AIProviderMessage["role"] {
  if (message.role === "visitor") return "user";
  return "assistant";
}

function assembleProviderPrompt(input: {
  aiConfig: AIConfiguration;
  selectedMessages: Message[];
  knowledgeContext: KnowledgeSearchResult[];
  enabledTools: AgentTool[];
  noAnswerInstruction?: string;
}): AIProviderPrompt {
  const systemPrompt = `${input.aiConfig.systemPrompt}${knowledgePrompt(input.knowledgeContext)}${toolsPrompt(input.enabledTools)}${input.noAnswerInstruction ?? ""}`;
  return {
    systemPrompt,
    messages: [
      { role: "system", content: systemPrompt },
      ...input.selectedMessages.map((message) => ({
        role: providerRole(message),
        content: message.content,
      })),
    ],
  };
}

function promptSummary(
  aiConfig: AIConfiguration,
  selectedMessages: Message[],
  knowledgeContext: KnowledgeSearchResult[],
  enabledTools: AgentTool[],
) {
  return {
    systemPromptLength: aiConfig.systemPrompt.length,
    selectedMessageCount: selectedMessages.length,
    knowledgeSourceCount: knowledgeContext.length,
    toolCount: enabledTools.length,
    maxContextMessages: aiConfig.maxContextMessages,
    knowledgeEnabled: aiConfig.enableKnowledgeBase,
    toolsEnabled: aiConfig.enableTools,
  };
}

export async function retrieveKnowledge(input: KnowledgeSearchOptions) {
  return store.searchKnowledge(input);
}

export async function generateAgentReply(
  conversation: ConversationWithMessages,
  options?: { persistReply?: boolean; actionOverride?: "test" },
): Promise<AgentRuntimeResult> {
  const persistReply = options?.persistReply ?? true;
  const actionOverride = options?.actionOverride;
  const startedAt = Date.now();
  const aiConfig = await store.getAIConfiguration();
  const selectedMessages = recentMessages(conversation.messages, aiConfig.maxContextMessages);
  const enabledTools = aiConfig.enableTools ? await listConfiguredTools("ai") : [];
  const emptyPromptSummary = promptSummary(aiConfig, selectedMessages, [], enabledTools);
  const baseTrace = {
    conversationId: actionOverride === "test" ? undefined : conversation.id,
    provider: aiConfig.provider,
    model: aiConfig.model,
    configSnapshot: configSnapshot(aiConfig),
    selectedMessages: traceMessages(selectedMessages),
    toolNames: enabledTools.map((tool) => tool.name),
    toolCallPlaceholders: [],
  };

  if (conversation.status !== "ai_active") {
    const trace = await store.addAITrace({
      ...baseTrace,
      action: actionOverride ?? "skipped",
      latencyMs: Date.now() - startedAt,
      knowledgeSources: [],
      fallbackReason: `status:${conversation.status}`,
    });
    return {
      action: "skipped",
      knowledgeContext: [],
      reason: `status:${conversation.status}`,
      trace,
      promptSummary: emptyPromptSummary,
    };
  }

  const handoffReason = shouldAutoHandoff(conversation, aiConfig);
  const repeatedFailureReason = repeatedAIFailureHandoffReason(conversation, aiConfig);
  const earlyHandoffReason = handoffReason ?? repeatedFailureReason;
  if (earlyHandoffReason) {
    if (persistReply) {
      await store.setConversationStatus(conversation.id, "queued_for_human");
      await store.addMessage({
        conversationId: conversation.id,
        role: "system",
        content: `Conversation queued for human support: ${earlyHandoffReason}.`,
        metadata: { handoffReason: earlyHandoffReason },
      });
      const updated = await store.getConversation(conversation.id);
      if (updated) publishConversation(updated);
    }
    const trace = await store.addAITrace({
      ...baseTrace,
      action: actionOverride ?? "handoff",
      latencyMs: Date.now() - startedAt,
      knowledgeSources: [],
      handoffReason: earlyHandoffReason,
    });
    return {
      action: "handoff",
      knowledgeContext: [],
      reason: earlyHandoffReason,
      trace,
      promptSummary: emptyPromptSummary,
    };
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

  const knowledgeHandoffReason = lowConfidenceKnowledgeHandoffReason(knowledgeContext, aiConfig);
  if (knowledgeHandoffReason) {
    if (persistReply) {
      await store.setConversationStatus(conversation.id, "queued_for_human");
      await store.addMessage({
        conversationId: conversation.id,
        role: "system",
        content: `Conversation queued for human support: ${knowledgeHandoffReason}.`,
        metadata: {
          handoffReason: knowledgeHandoffReason,
          topKnowledgeScore: knowledgeContext[0]?.score,
          threshold: aiConfig.autoHandoff.lowConfidenceKnowledgeScoreThreshold,
        },
      });
      const updated = await store.getConversation(conversation.id);
      if (updated) publishConversation(updated);
    }
    const trace = await store.addAITrace({
      ...baseTrace,
      action: actionOverride ?? "handoff",
      latencyMs: Date.now() - startedAt,
      knowledgeSources: traceKnowledgeSources(knowledgeContext),
      handoffReason: knowledgeHandoffReason,
    });
    if (persistReply && !actionOverride && knowledgeContext.length > 0) {
      await emitWebhook("knowledge.hit", knowledgeHitEventPayload({ conversation, sources: knowledgeContext, trace }));
    }
    return {
      action: "handoff",
      knowledgeContext,
      reason: knowledgeHandoffReason,
      trace,
      promptSummary: promptSummary(aiConfig, selectedMessages, knowledgeContext, enabledTools),
    };
  }

  const noAnswerStrategyReason = noAnswerReason(aiConfig, latestVisitorMessage, knowledgeContext);
  if (noAnswerStrategyReason && aiConfig.noAnswerStrategy === "fallback") {
    let reply: Message | undefined;
    if (persistReply) {
      reply = await store.addMessage({
        conversationId: conversation.id,
        role: "ai",
        content: aiConfig.fallbackMessage,
        metadata: {
          provider: aiConfig.provider,
          model: aiConfig.model,
          knowledgeSources: [],
          fallbackReason: noAnswerStrategyReason,
          noAnswerStrategy: aiConfig.noAnswerStrategy,
          toolCallPlaceholders: [],
        },
      });
    }
    const trace = await store.addAITrace({
      ...baseTrace,
      action: actionOverride ?? "replied",
      latencyMs: Date.now() - startedAt,
      knowledgeSources: [],
      fallbackReason: noAnswerStrategyReason,
      replyMessageId: reply?.id,
    });
    if (persistReply && !actionOverride) {
      await emitWebhook("ai.fallback", aiFallbackEventPayload({ conversation, trace, reason: noAnswerStrategyReason, reply }));
    }
    return {
      action: "replied",
      reply,
      replyText: aiConfig.fallbackMessage,
      knowledgeContext,
      trace,
      reason: noAnswerStrategyReason,
      promptSummary: promptSummary(aiConfig, selectedMessages, knowledgeContext, enabledTools),
    };
  }

  if (
    noAnswerStrategyReason &&
    (aiConfig.noAnswerStrategy === "handoff" || aiConfig.noAnswerStrategy === "transfer")
  ) {
    if (persistReply) {
      await store.setConversationStatus(conversation.id, "queued_for_human");
      await store.addMessage({
        conversationId: conversation.id,
        role: "system",
        content: `Conversation queued for human support: ${noAnswerStrategyReason}.`,
        metadata: {
          handoffReason: noAnswerStrategyReason,
          noAnswerStrategy: aiConfig.noAnswerStrategy,
        },
      });
      const updated = await store.getConversation(conversation.id);
      if (updated) publishConversation(updated);
    }
    const trace = await store.addAITrace({
      ...baseTrace,
      action: actionOverride ?? "handoff",
      latencyMs: Date.now() - startedAt,
      knowledgeSources: [],
      handoffReason: noAnswerStrategyReason,
    });
    return {
      action: "handoff",
      knowledgeContext,
      reason: noAnswerStrategyReason,
      trace,
      promptSummary: promptSummary(aiConfig, selectedMessages, knowledgeContext, enabledTools),
    };
  }

  const provider = getAIProvider(aiConfig);
  const prompt = assembleProviderPrompt({
    aiConfig,
    selectedMessages,
    knowledgeContext,
    enabledTools,
    noAnswerInstruction: noAnswerPrompt(aiConfig, latestVisitorMessage, knowledgeContext),
  });
  const providerStartedAt = Date.now();
  let replyText = "";
  let toolCallPlaceholders: AITrace["toolCallPlaceholders"] = [];
  let error: string | undefined;
  let fallbackReason: string | undefined;
  try {
    if (aiConfig.provider === "openai" && !process.env.OPENAI_API_KEY) {
      fallbackReason = "missing_openai_api_key";
    }
    const providerResult = await provider.generateReply({
      conversation,
      prompt,
      tools: enabledTools,
      aiConfig,
    });
    replyText = providerResult.text;
    toolCallPlaceholders = providerResult.toolCallPlaceholders;
    if (!replyText && toolCallPlaceholders.length) {
      fallbackReason = "tool_call_requested_not_executed";
    }
  } catch (exception) {
    error = exception instanceof Error ? exception.message : "AI provider failed";
    fallbackReason = fallbackReason ?? "provider_error";
    replyText = aiConfig.fallbackMessage;
  }

  if (!replyText) {
    fallbackReason = fallbackReason ?? "empty_provider_reply";
    replyText = aiConfig.fallbackMessage;
  }

  let reply: Message | undefined;
  if (persistReply) {
    reply = await store.addMessage({
      conversationId: conversation.id,
      role: "ai",
      content: replyText,
      metadata: {
        provider: aiConfig.provider,
        model: aiConfig.model,
        knowledgeSources: traceKnowledgeSources(knowledgeContext),
        fallbackReason,
        toolCallPlaceholders,
      },
    });
  }

  const trace = await store.addAITrace({
    ...baseTrace,
    action: actionOverride ?? (error ? "failed" : "replied"),
    latencyMs: Date.now() - providerStartedAt,
    knowledgeSources: traceKnowledgeSources(knowledgeContext),
    toolCallPlaceholders,
    fallbackReason,
    error,
    replyMessageId: reply?.id,
  });
  if (persistReply && !actionOverride && knowledgeContext.length > 0) {
    await emitWebhook("knowledge.hit", knowledgeHitEventPayload({ conversation, sources: knowledgeContext, trace }));
  }
  if (persistReply && !actionOverride && fallbackReason) {
    await emitWebhook("ai.fallback", aiFallbackEventPayload({ conversation, trace, reason: fallbackReason, reply }));
  }
  return {
    action: "replied",
    reply,
    replyText,
    knowledgeContext,
    trace,
    reason: fallbackReason,
    promptSummary: promptSummary(aiConfig, selectedMessages, knowledgeContext, enabledTools),
  };
}
