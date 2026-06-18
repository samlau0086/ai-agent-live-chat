import { NextResponse } from "next/server";
import { getOrCreateVisitorSession } from "@/lib/auth";
import { sseStream, subscribe } from "@/lib/events";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const visitorSessionId = await getOrCreateVisitorSession();
  const conversation = await store.getOrCreateConversation(visitorSessionId);
  const stream = sseStream(conversation, (send) => subscribe("conversation", conversation.id, send));

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
