import { NextResponse } from "next/server";
import { messageEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { emitWebhook, verifyWebhookSignature } from "@/lib/webhooks";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-live-chat-signature") ?? "")) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { id } = await context.params;
  let body: { content?: string; internal?: boolean; metadata?: Record<string, unknown> };
  try {
    body = JSON.parse(raw || "{}") as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const content = String(body.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const conversation = await store.getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const metadata: Record<string, unknown> = { ...(body.metadata ?? {}), source: "integration" };
  if (body.internal) metadata.internalNote = true;
  const message = await store.addMessage({
    conversationId: id,
    role: "system",
    content: `External note: ${content}`,
    metadata,
  });
  const updated = await store.getConversation(id);
  if (updated) publishConversation(updated);
  await emitWebhook("message.created", messageEventPayload(message, updated));
  return NextResponse.json({ message, conversation: updated });
}
