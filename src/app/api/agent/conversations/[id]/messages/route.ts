import { NextResponse } from "next/server";
import { saveMessageAttachments } from "@/lib/attachments";
import { requireActiveAgentRequest } from "@/lib/auth";
import { messageEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { outgoingMessageMetadata } from "@/lib/translation";
import { emitWebhook } from "@/lib/webhooks";

async function parseMessageRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const files = form.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0);
    return {
      content: String(form.get("content") ?? "").trim(),
      files,
    };
  }
  const body = (await request.json().catch(() => ({}))) as { content?: string };
  return { content: String(body.content ?? "").trim(), files: [] as File[] };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveAgentRequest("agent.conversations.reply");
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const { content, files } = await parseMessageRequest(request);
  if (!content && !files.length) return NextResponse.json({ error: "content or attachment is required" }, { status: 400 });

  const conversation = await store.getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (conversation.status !== "human_active") {
    return NextResponse.json({ error: "Take over the conversation before replying" }, { status: 409 });
  }

  let attachments;
  try {
    attachments = await saveMessageAttachments(files);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Attachment upload failed" }, { status: 400 });
  }

  const messageContent = content || `Uploaded ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}.`;
  const aiConfig = await store.getAIConfiguration();
  const metadata = await outgoingMessageMetadata({
    conversation,
    aiConfig,
    role: "human_agent",
    content: messageContent,
    metadata: attachments.length ? { attachments } : undefined,
  });
  const message = await store.addMessage({
    conversationId: id,
    role: "human_agent",
    content: messageContent,
    agentId: auth.user.id,
    metadata,
  });
  const updated = await store.getConversation(id);
  if (updated) publishConversation(updated);
  await emitWebhook("message.created", messageEventPayload(message, updated));
  return NextResponse.json({ conversation: updated, message });
}
