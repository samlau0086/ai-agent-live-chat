import { NextResponse } from "next/server";
import { getOrCreateVisitorSession } from "@/lib/auth";
import { isValidEmail } from "@/lib/chat-profile";
import { conversationEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { sanitizeConversationForVisitor, store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

export async function PUT(request: Request) {
  const visitorSessionId = await getOrCreateVisitorSession();
  const body = (await request.json().catch(() => ({}))) as { name?: string; email?: string };
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!isValidEmail(email)) return NextResponse.json({ error: "valid email is required" }, { status: 400 });

  const before = await store.getConversationByVisitorSession(visitorSessionId);
  const conversation = await store.getOrCreateConversation(visitorSessionId);
  if (!before) await emitWebhook("conversation.created", conversationEventPayload(conversation, { source: "widget" }));

  const updated = await store.mergeConversationMetadata(conversation.id, {
    customerProfile: {
      ...(conversation.customerProfile ?? {}),
      name,
      email,
    },
    preChatCompletedAt: new Date().toISOString(),
  });
  publishConversation(updated);
  return NextResponse.json({ conversation: sanitizeConversationForVisitor(updated) });
}
