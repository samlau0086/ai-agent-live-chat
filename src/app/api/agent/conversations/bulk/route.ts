import { NextResponse } from "next/server";
import { requireActiveAgentRequest } from "@/lib/auth";
import { publish, publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import type { ConversationStatus } from "@/lib/types";

const statuses = new Set<ConversationStatus>(["ai_active", "queued_for_human", "human_active", "resolved", "closed"]);

type BulkRequest = {
  ids?: unknown;
  action?: unknown;
  status?: unknown;
};

function normalizeIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

export async function POST(request: Request) {
  const auth = await requireActiveAgentRequest("agent.conversations.bulk");
  if (auth.response) return auth.response;
  if (auth.user.role === "viewer") return NextResponse.json({ error: "admin or agent role required" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as BulkRequest;
  const ids = normalizeIds(body.ids);
  const action = String(body.action ?? "");
  if (!ids.length) return NextResponse.json({ error: "ids are required" }, { status: 400 });
  if (action !== "delete" && action !== "set_status") {
    return NextResponse.json({ error: "Unsupported bulk action" }, { status: 400 });
  }

  const status = String(body.status ?? "") as ConversationStatus;
  if (action === "set_status" && !statuses.has(status)) {
    return NextResponse.json({ error: "Valid status is required" }, { status: 400 });
  }

  const results = [];
  for (const id of ids) {
    try {
      const existing = await store.getConversation(id);
      if (!existing) throw new Error("Conversation not found");

      if (action === "delete") {
        await store.deleteConversation(id, auth.user.id);
        publish("conversation", id, { deletedId: id });
        publish("conversations", undefined, { deletedId: id });
        results.push({ id, ok: true, deletedId: id });
        continue;
      }

      const agentId = status === "human_active" ? auth.user.id : undefined;
      await store.setConversationStatus(id, status, agentId);
      await store.addMessage({
        conversationId: id,
        role: "system",
        content: `${auth.user.username} bulk updated conversation status to ${status}.`,
        metadata: { internalNote: true, bulkAction: true, status },
      });
      const updated = await store.getConversation(id);
      if (updated) publishConversation(updated);
      results.push({ id, ok: true, status });
    } catch (error) {
      results.push({ id, ok: false, error: error instanceof Error ? error.message : "Bulk operation failed" });
    }
  }

  return NextResponse.json({ results });
}
