import { NextResponse } from "next/server";
import { conversationEventPayload, messageEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { emitWebhook, verifyWebhookSignature } from "@/lib/webhooks";

function verifyRequest(raw: string, request: Request) {
  return verifyWebhookSignature(raw, request.headers.get("x-live-chat-signature") ?? "");
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyRequest(raw, request)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let body: {
    visitorSessionId?: string;
    externalUserId?: string;
    subject?: string;
    metadata?: Record<string, unknown>;
    systemNote?: string;
  };
  try {
    body = JSON.parse(raw || "{}") as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const conversation = await store.createConversation({
    visitorSessionId: body.visitorSessionId,
    externalUserId: body.externalUserId,
    subject: body.subject,
    metadata: body.metadata,
  });
  let noteMessage;
  if (body.systemNote) {
    noteMessage = await store.addMessage({
      conversationId: conversation.id,
      role: "system",
      content: `External note: ${body.systemNote}`,
      metadata: { source: "integration" },
    });
  }
  const updated = (await store.getConversation(conversation.id)) ?? conversation;
  publishConversation(updated);
  await emitWebhook("conversation.created", conversationEventPayload(updated, { source: "integration" }));
  if (noteMessage) await emitWebhook("message.created", messageEventPayload(noteMessage, updated));
  return NextResponse.json({ conversation: updated });
}
