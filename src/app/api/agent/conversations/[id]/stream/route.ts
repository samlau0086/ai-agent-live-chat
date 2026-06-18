import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { sseStream, subscribe } from "@/lib/events";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAgent();
  if (!user) return unauthorized();
  const { id } = await context.params;
  const conversation = await store.getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const stream = sseStream(conversation, (send) => subscribe("conversation", id, send));
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
