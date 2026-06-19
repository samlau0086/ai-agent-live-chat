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
  let body: { externalUserId?: string; metadata?: Record<string, unknown> };
  try {
    body = JSON.parse(raw || "{}") as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const externalUserId = String(body.externalUserId ?? "").trim();
  if (!externalUserId) return NextResponse.json({ error: "externalUserId is required" }, { status: 400 });

  const existing = await store.getConversation(id);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const conversation = await store.bindConversationExternalUser(id, externalUserId, body.metadata ?? {});
  publishConversation(conversation);
  return NextResponse.json({ conversation });
}
