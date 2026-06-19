import { NextResponse } from "next/server";
import { requireRoleRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { ConversationWithMessages, Message } from "@/lib/types";

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "for",
  "help",
  "how",
  "i",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "what",
  "with",
  "you",
]);

function normalizeQuestion(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function clusterKey(question: string) {
  const tokens = [...new Set(normalizeQuestion(question))].sort();
  return tokens.slice(0, 5).join(":") || question.toLowerCase().slice(0, 48);
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
  if (messages.length === 0) return "no_response";
  for (const message of messages) {
    const fallbackReason = typeof message.metadata.fallbackReason === "string" ? message.metadata.fallbackReason : "";
    const handoffReason = typeof message.metadata.handoffReason === "string" ? message.metadata.handoffReason : "";
    const error = typeof message.metadata.error === "string" ? message.metadata.error : "";
    const knowledgeSources = Array.isArray(message.metadata.knowledgeSources) ? message.metadata.knowledgeSources : [];
    if (fallbackReason.startsWith("no_knowledge")) return fallbackReason;
    if (handoffReason.startsWith("no_knowledge")) return handoffReason;
    if (handoffReason === "low_confidence_knowledge") return handoffReason;
    if (fallbackReason || error) return fallbackReason || "ai_error";
    if (message.role === "ai" && knowledgeSources.length === 0 && message.metadata.provider) return "ungrounded_ai_reply";
  }
  return undefined;
}

function latestVisitorBeforeMiss(conversation: ConversationWithMessages) {
  const missed = [];
  for (let index = 0; index < conversation.messages.length; index += 1) {
    const message = conversation.messages[index];
    if (message.role !== "visitor") continue;
    const reason = missReason(nextMessagesUntilVisitor(conversation.messages, index));
    if (!reason) continue;
    missed.push({ message, reason });
  }
  return missed;
}

function channel(conversation: ConversationWithMessages) {
  const metadataChannel = conversation.metadata.channel;
  if (typeof metadataChannel === "string" && metadataChannel.trim()) return metadataChannel;
  const [prefix] = conversation.visitorSessionId.split(":");
  return prefix && prefix !== conversation.visitorSessionId ? prefix : "web";
}

export async function GET(request: Request) {
  const auth = await requireRoleRequest(["admin", "viewer"], "admin.missed_questions.read");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 20)));
  const minClusterSize = Math.max(1, Math.min(20, Number(url.searchParams.get("minClusterSize") ?? 1)));
  const conversations = await store.listConversations();
  const groups = new Map<
    string,
    {
      key: string;
      count: number;
      reasons: Record<string, number>;
      channels: Record<string, number>;
      examples: Array<{
        conversationId: string;
        messageId: string;
        content: string;
        reason: string;
        channel: string;
        createdAt: string;
      }>;
    }
  >();

  for (const conversation of conversations) {
    for (const missed of latestVisitorBeforeMiss(conversation)) {
      const key = clusterKey(missed.message.content);
      const item =
        groups.get(key) ??
        {
          key,
          count: 0,
          reasons: {},
          channels: {},
          examples: [],
        };
      const itemChannel = channel(conversation);
      item.count += 1;
      item.reasons[missed.reason] = (item.reasons[missed.reason] ?? 0) + 1;
      item.channels[itemChannel] = (item.channels[itemChannel] ?? 0) + 1;
      item.examples.push({
        conversationId: conversation.id,
        messageId: missed.message.id,
        content: missed.message.content,
        reason: missed.reason,
        channel: itemChannel,
        createdAt: missed.message.createdAt,
      });
      groups.set(key, item);
    }
  }

  const clusters = [...groups.values()]
    .filter((item) => item.count >= minClusterSize)
    .sort((a, b) => b.count - a.count || b.examples[0].createdAt.localeCompare(a.examples[0].createdAt))
    .slice(0, limit)
    .map((item) => {
      const representative = item.examples[0];
      return {
        ...item,
        examples: item.examples.slice(0, 5),
        suggestedKnowledgeEntry: {
          title: representative.content.slice(0, 80),
          question: representative.content,
          answerDraft: "Add a concise support answer for this repeated missed question.",
          sourceType: "manual",
        },
      };
    });

  return NextResponse.json({
    missedQuestions: {
      totalClusters: clusters.length,
      clusters,
    },
  });
}
