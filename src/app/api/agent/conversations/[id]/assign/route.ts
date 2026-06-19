import { NextResponse } from "next/server";
import { requireRoleRequest } from "@/lib/auth";
import { handoffEventPayload } from "@/lib/event-contracts";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import { emitWebhook } from "@/lib/webhooks";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleRequest(["admin", "agent"], "agent.conversations.assign");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { agentId?: string };
  const agentId = String(body.agentId ?? "").trim();
  if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });

  const [existing, assignee] = await Promise.all([store.getConversation(id), store.findUserById(agentId)]);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (!assignee || assignee.disabled || !["admin", "agent"].includes(assignee.role)) {
    return NextResponse.json({ error: "Assignable agent not found" }, { status: 404 });
  }
  if (existing.status === "closed" || existing.status === "resolved") {
    return NextResponse.json({ error: "Closed or resolved conversations cannot be assigned" }, { status: 409 });
  }

  const conversation = await store.setConversationStatus(id, "human_active", assignee.id);
  await store.addAuditLog({
    actorId: auth.user.id,
    action: "conversation.assigned",
    targetType: "Conversation",
    targetId: id,
    metadata: {
      assignedToId: assignee.id,
      assignedToUsername: assignee.username,
      previousAgentId: existing.takenOverById,
      previousStatus: existing.status,
    },
  });
  await store.addMessage({
    conversationId: id,
    role: "system",
    content:
      assignee.id === auth.user.id
        ? `${auth.user.username} assigned the conversation to themselves.`
        : `${auth.user.username} assigned the conversation to ${assignee.username}.`,
    metadata: { assignedById: auth.user.id, assignedToId: assignee.id },
  });
  const updated = await store.getConversation(id);
  if (updated) publishConversation(updated);
  await emitWebhook(
    "handoff.started",
    handoffEventPayload(updated ?? conversation, { actorId: auth.user.id, assignedToId: assignee.id }),
  );
  return NextResponse.json({ conversation: updated ?? conversation });
}
