import { NextResponse } from "next/server";
import { requireRoleRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { ConversationWithMessages } from "@/lib/types";

function conversationChannel(conversation: ConversationWithMessages) {
  const channel = conversation.metadata.channel;
  if (typeof channel === "string" && channel.trim()) return channel;
  const [prefix] = conversation.visitorSessionId.split(":");
  return prefix && prefix !== conversation.visitorSessionId ? prefix : "web";
}

function satisfaction(conversation: ConversationWithMessages) {
  const value = conversation.metadata.satisfaction;
  if (!value || typeof value !== "object") return undefined;
  const rating = Number((value as { rating?: unknown }).rating);
  if (!Number.isFinite(rating)) return undefined;
  return {
    rating,
    comment:
      typeof (value as { comment?: unknown }).comment === "string"
        ? ((value as { comment: string }).comment)
        : undefined,
    submittedAt:
      typeof (value as { submittedAt?: unknown }).submittedAt === "string"
        ? ((value as { submittedAt: string }).submittedAt)
        : undefined,
  };
}

function latestMessage(conversation: ConversationWithMessages) {
  return [...conversation.messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function lastVisitorMessage(conversation: ConversationWithMessages) {
  return [...conversation.messages].reverse().find((message) => message.role === "visitor");
}

function reviewSummary(conversation: ConversationWithMessages) {
  const latest = latestMessage(conversation);
  const visitor = lastVisitorMessage(conversation);
  const score = satisfaction(conversation);
  return {
    id: conversation.id,
    status: conversation.status,
    subject: conversation.subject,
    channel: conversationChannel(conversation),
    rating: score?.rating,
    satisfactionComment: score?.comment,
    satisfactionSubmittedAt: score?.submittedAt,
    tags: conversation.tags ?? [],
    takenOverBy: conversation.takenOverBy,
    updatedAt: conversation.updatedAt,
    createdAt: conversation.createdAt,
    latestMessageAt: latest?.createdAt,
    latestMessageRole: latest?.role,
    lastVisitorMessage: visitor?.content,
    aiMessages: conversation.messages.filter((message) => message.role === "ai").length,
    humanMessages: conversation.messages.filter((message) => message.role === "human_agent").length,
  };
}

export async function GET(request: Request) {
  const auth = await requireRoleRequest(["admin", "viewer"], "admin.reviews.read");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const lowRatingThreshold = Math.max(1, Math.min(5, Number(url.searchParams.get("lowRatingThreshold") ?? 2)));
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 20)));
  const conversations = await store.listConversations();

  const lowRating = conversations
    .filter((conversation) => {
      const score = satisfaction(conversation);
      return score && score.rating <= lowRatingThreshold;
    })
    .sort(
      (a, b) =>
        (satisfaction(b)?.submittedAt ?? b.updatedAt).localeCompare(satisfaction(a)?.submittedAt ?? a.updatedAt),
    )
    .slice(0, limit)
    .map(reviewSummary);

  const unresolved = conversations
    .filter((conversation) => !["resolved", "closed"].includes(conversation.status))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, limit)
    .map((conversation) => ({
      ...reviewSummary(conversation),
      waitingSeconds: Math.max(0, Math.round((Date.now() - Date.parse(conversation.updatedAt)) / 1000)),
    }));

  return NextResponse.json({
    reviews: {
      lowRatingThreshold,
      lowRating,
      unresolved,
    },
  });
}
