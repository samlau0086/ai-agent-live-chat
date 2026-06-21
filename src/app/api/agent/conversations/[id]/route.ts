import { NextResponse } from "next/server";
import { requireActiveAgentRequest } from "@/lib/auth";
import { publish } from "@/lib/events";
import { store } from "@/lib/store";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveAgentRequest("agent.conversations.delete");
  if (auth.response) return auth.response;
  if (auth.user.role === "viewer") {
    return NextResponse.json({ error: "admin or agent role required" }, { status: 403 });
  }

  const { id } = await context.params;
  const existing = await store.getConversation(id);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  await store.deleteConversation(id, auth.user.id);
  publish("conversation", id, { deletedId: id });
  publish("conversations", undefined, { deletedId: id });
  return NextResponse.json({ ok: true, deletedId: id });
}

