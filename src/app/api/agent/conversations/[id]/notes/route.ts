import { NextResponse } from "next/server";
import { requireRoleRequest } from "@/lib/auth";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleRequest(["admin", "agent"], "agent.conversations.notes.create");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { content?: string };
  const content = String(body.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const conversation = await store.getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  await store.addMessage({
    conversationId: id,
    role: "system",
    content,
    agentId: auth.user.id,
    metadata: { internalNote: true, authorUsername: auth.user.username },
  });
  const updated = await store.getConversation(id);
  if (updated) publishConversation(updated);
  return NextResponse.json({ conversation: updated });
}
