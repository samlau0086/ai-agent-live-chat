import { NextResponse } from "next/server";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { verifyWebhookSignature } from "@/lib/webhooks";

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-live-chat-signature") ?? "";
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(raw) as {
    conversationId?: string;
    metadata?: Record<string, unknown>;
    note?: string;
  };
  if (!body.conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

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
