import { NextResponse } from "next/server";
import { requireActiveAgentRequest } from "@/lib/auth";
import { sendConfiguredEmail } from "@/lib/email";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { conversationTranscriptText } from "@/lib/transcript";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveAgentRequest("agent.conversations.transcript_email");
  if (auth.response) return auth.response;
  if (auth.user.role === "viewer") return NextResponse.json({ error: "Agent or admin role required" }, { status: 403 });

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { email?: string; includeInternal?: boolean };
  const conversation = await store.getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const email = String(body.email ?? conversation.customerProfile?.email ?? "").trim();
  if (!email) return NextResponse.json({ error: "Customer email is not available" }, { status: 400 });
  if (!validEmail(email)) return NextResponse.json({ error: "Invalid email address" }, { status: 400 });

  await sendConfiguredEmail({
    to: email,
    subject: `Live chat transcript ${conversation.id}`,
    text: conversationTranscriptText(conversation, { includeInternal: Boolean(body.includeInternal) }),
  });

  await store.addMessage({
    conversationId: id,
    role: "system",
    content: `${auth.user.username} emailed the transcript to ${email}.`,
    metadata: { internalNote: true, emailTranscript: true, email },
  });
  const updated = await store.getConversation(id);
  if (updated) publishConversation(updated);

  return NextResponse.json({ ok: true, email });
}
