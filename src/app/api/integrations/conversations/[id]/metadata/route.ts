import { NextResponse } from "next/server";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { verifyWebhookSignature } from "@/lib/webhooks";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-live-chat-signature") ?? "")) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { id } = await context.params;
  let body: { metadata?: Record<string, unknown>; note?: string };
  try {
    body = JSON.parse(raw || "{}") as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const conversation = await store.getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  let updated = await store.mergeConversationMetadata(id, body.metadata ?? {});
  if (body.note) {
    await store.addMessage({
      conversationId: id,
      role: "system",
      content: `External note: ${body.note}`,
      metadata: { source: "integration" },
    });
    updated = (await store.getConversation(id)) ?? updated;
  }
  publishConversation(updated);
  return NextResponse.json({ conversation: updated });
}
