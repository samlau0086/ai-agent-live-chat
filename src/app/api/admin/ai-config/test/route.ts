import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-runtime";
import { requireAdminRequest } from "@/lib/auth";
import type { ConversationWithMessages, Message } from "@/lib/types";

export async function POST(request: Request) {
  const auth = await requireAdminRequest("admin.ai_config.test");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const content = String(body.message ?? "").trim() || "How can you help me?";
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
  const result = await generateAgentReply(conversation, {
    persistReply: false,
    actionOverride: "test",
  });
  return NextResponse.json({
    reply: result.replyText,
    action: result.action,
    reason: result.reason,
    promptSummary: result.promptSummary,
    knowledgeContext: result.knowledgeContext,
    trace: result.trace
      ? {
          id: result.trace.id,
          provider: result.trace.provider,
          model: result.trace.model,
          latencyMs: result.trace.latencyMs,
          selectedMessageCount: result.trace.selectedMessages.length,
          knowledgeSourceCount: result.trace.knowledgeSources.length,
          toolNames: result.trace.toolNames,
          toolCallPlaceholders: result.trace.toolCallPlaceholders,
          handoffReason: result.trace.handoffReason,
          fallbackReason: result.trace.fallbackReason,
          error: result.trace.error,
        }
      : undefined,
  });
}
