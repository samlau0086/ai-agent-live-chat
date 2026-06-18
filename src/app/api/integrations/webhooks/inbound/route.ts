import { NextResponse } from "next/server";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { verifyWebhookSignature } from "@/lib/webhooks";

type InboundWebhookBody = {
  conversationId?: string;
  metadata?: Record<string, unknown>;
  note?: string;
};

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-live-chat-signature") ?? "";
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: InboundWebhookBody;

  try {
    body = JSON.parse(raw) as InboundWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  const existing = await store.getConversation(body.conversationId);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  let conversation = await store.mergeConversationMetadata(body.conversationId, body.metadata ?? {});
  if (body.note) {
    await store.addMessage({
      conversationId: body.conversationId,
      role: "system",
      content: `External note: ${body.note}`,
      metadata: { source: "inbound_webhook" },
    });
    conversation = (await store.getConversation(body.conversationId)) ?? conversation;
  }
  publishConversation(conversation);
  return NextResponse.json({ conversation });
}
