import { NextResponse } from "next/server";
import { requireRoleRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { ConversationWithMessages, KnowledgeEmbedding, Message } from "@/lib/types";

const stopWords = new Set([
  "and",
  "are",
  "can",
  "for",
  "help",
  "how",
  "the",
  "what",
  "with",
  "you",
]);

function tokens(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function clusterKey(input: string) {
  return [...new Set(tokens(input))].sort().slice(0, 5).join(":") || input.toLowerCase().slice(0, 48);
}

function nextMessagesUntilVisitor(messages: Message[], startIndex: number) {
  const result: Message[] = [];
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    if (messages[index].role === "visitor") break;
    result.push(messages[index]);
  }
  return result;
}

function missReason(messages: Message[]) {
  if (!messages.length) return "no_response";
  for (const message of messages) {
    const fallbackReason = typeof message.metadata.fallbackReason === "string" ? message.metadata.fallbackReason : "";
    const handoffReason = typeof message.metadata.handoffReason === "string" ? message.metadata.handoffReason : "";
    const knowledgeSources = Array.isArray(message.metadata.knowledgeSources) ? message.metadata.knowledgeSources : [];
    if (fallbackReason.startsWith("no_knowledge")) return fallbackReason;
    if (handoffReason.startsWith("no_knowledge")) return handoffReason;
    if (handoffReason === "low_confidence_knowledge") return handoffReason;
    if (fallbackReason) return fallbackReason;
    if (message.role === "ai" && knowledgeSources.length === 0 && message.metadata.provider) return "ungrounded_ai_reply";
  }
  return undefined;
}

function previousVisitorMessage(conversation: ConversationWithMessages, message: Message) {
  const index = conversation.messages.findIndex((item) => item.id === message.id);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (conversation.messages[cursor].role === "visitor") return conversation.messages[cursor];
  }
  return undefined;
}

function collectKnowledgeHits(conversations: ConversationWithMessages[]) {
  const hits = new Map<string, { count: number; scoreTotal: number; documentId?: string; knowledgeBaseId?: string }>();
  const fallbackReasons = new Map<string, { count: number; examples: string[] }>();
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const fallbackReason = typeof message.metadata.fallbackReason === "string" ? message.metadata.fallbackReason : "";
      if (fallbackReason) {
        const item = fallbackReasons.get(fallbackReason) ?? { count: 0, examples: [] };
        item.count += 1;
        const visitor = previousVisitorMessage(conversation, message);
        if (visitor && item.examples.length < 3) item.examples.push(visitor.content);
        fallbackReasons.set(fallbackReason, item);
      }
      const sources = Array.isArray(message.metadata.knowledgeSources) ? message.metadata.knowledgeSources : [];
      for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        const typed = source as { chunkId?: string; documentId?: string; knowledgeBaseId?: string; score?: number };
        if (!typed.chunkId) continue;
        const item = hits.get(typed.chunkId) ?? { count: 0, scoreTotal: 0 };
        item.count += 1;
        item.scoreTotal += Number(typed.score ?? 0);
        item.documentId = typed.documentId ?? item.documentId;
        item.knowledgeBaseId = typed.knowledgeBaseId ?? item.knowledgeBaseId;
        hits.set(typed.chunkId, item);
      }
    }
  }
  return { hits, fallbackReasons };
}

function collectQuestionGaps(conversations: ConversationWithMessages[], limit: number) {
  const groups = new Map<
    string,
    { key: string; count: number; reasons: Record<string, number>; examples: Array<{ content: string; reason: string }> }
  >();
  for (const conversation of conversations) {
    for (let index = 0; index < conversation.messages.length; index += 1) {
      const message = conversation.messages[index];
      if (message.role !== "visitor") continue;
      const reason = missReason(nextMessagesUntilVisitor(conversation.messages, index));
      if (!reason) continue;
      const key = clusterKey(message.content);
      const item = groups.get(key) ?? { key, count: 0, reasons: {}, examples: [] };
      item.count += 1;
      item.reasons[reason] = (item.reasons[reason] ?? 0) + 1;
      if (item.examples.length < 3) item.examples.push({ content: message.content, reason });
      groups.set(key, item);
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((group) => ({
      ...group,
      suggestedAction: "Create or update a knowledge base entry for this repeated unanswered question.",
    }));
}

function embeddingKey(embedding: KnowledgeEmbedding) {
  return embedding.chunkId;
}

export async function GET(request: Request) {
  const auth = await requireRoleRequest(["admin", "viewer"], "admin.knowledge_gaps.read");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 20)));
  const staleDays = Math.max(1, Math.min(3650, Number(url.searchParams.get("staleDays") ?? 90)));
  const lowScoreThreshold = Math.max(0, Math.min(1, Number(url.searchParams.get("lowScoreThreshold") ?? 0.2)));
  const [conversations, documents, embeddings] = await Promise.all([
    store.listConversations(),
    store.listKnowledgeDocuments(),
    store.listKnowledgeEmbeddings(),
  ]);
  const { hits, fallbackReasons } = collectKnowledgeHits(conversations);
  const now = Date.now();
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  const documentsById = new Map(documents.map((document) => [document.id, document]));

  const staleDocuments = documents
    .filter((document) => {
      if (!document.enabled) return false;
      const indexedAt = document.indexedAt ? Date.parse(document.indexedAt) : Date.parse(document.updatedAt);
      return !indexedAt || now - indexedAt > staleMs;
    })
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, limit)
    .map((document) => ({
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      title: document.title,
      sourceType: document.sourceType,
      indexedAt: document.indexedAt,
      updatedAt: document.updatedAt,
    }));

  const failedDocuments = documents
    .filter((document) => document.indexingStatus === "failed")
    .slice(0, limit)
    .map((document) => ({
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      title: document.title,
      lastIndexError: document.lastIndexError,
      updatedAt: document.updatedAt,
    }));

  const lowPerformingChunks = embeddings
    .filter((embedding) => embedding.status === "indexed")
    .map((embedding) => {
      const hit = hits.get(embeddingKey(embedding));
      const averageScore = hit?.count ? hit.scoreTotal / hit.count : 0;
      const document = documentsById.get(embedding.documentId);
      return {
        chunkId: embedding.chunkId,
        documentId: embedding.documentId,
        knowledgeBaseId: embedding.knowledgeBaseId,
        documentTitle: document?.title ?? "Unknown document",
        hitCount: hit?.count ?? 0,
        averageScore,
        reason: !hit?.count ? "no_hits" : averageScore < lowScoreThreshold ? "low_average_score" : "ok",
      };
    })
    .filter((chunk) => chunk.reason !== "ok")
    .sort((a, b) => a.hitCount - b.hitCount || a.averageScore - b.averageScore)
    .slice(0, limit);

  const fallbackTrends = [...fallbackReasons.entries()]
    .map(([reason, item]) => ({ reason, count: item.count, examples: item.examples }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return NextResponse.json({
    knowledgeGaps: {
      frequentNoReliableHits: collectQuestionGaps(conversations, limit),
      staleDocuments,
      failedDocuments,
      lowPerformingChunks,
      fallbackTrends,
      thresholds: { staleDays, lowScoreThreshold },
    },
  });
}
