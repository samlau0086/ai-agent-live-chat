import { NextResponse } from "next/server";
import { getAIProvider } from "@/lib/ai";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";
import { tools } from "@/lib/tools";
import type { ConversationWithMessages, Message } from "@/lib/types";

function forbidden() {
  return NextResponse.json({ error: "Admin role required" }, { status: 403 });
}

export async function POST(request: Request) {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const content = String(body.message ?? "").trim() || "How can you help me?";
  const aiConfig = await store.getAIConfiguration();
  const knowledgeContext = aiConfig.enableKnowledgeBase
    ? await store.searchKnowledge({ query: content, knowledgeBaseIds: aiConfig.knowledgeBaseIds, topK: 5 })
    : [];
  const messages: Message[] = [
    {
      id: "test_msg",
      conversationId: "test_conversation",
      role: "visitor",
      content,
      metadata: {},
      createdAt: new Date().toISOString(),
    },
  ];
  const conversation: ConversationWithMessages = {
    id: "test_conversation",
    visitorSessionId: "test_visitor",
    status: "ai_active",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  };
  const reply = await getAIProvider(aiConfig).generateReply({
    conversation,
    messages,
    tools: aiConfig.enableTools ? tools : [],
    aiConfig,
    knowledgeContext,
  });
  return NextResponse.json({ reply, knowledgeContext });
}
