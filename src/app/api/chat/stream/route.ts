import { NextResponse } from "next/server";
import { getOrCreateVisitorSession } from "@/lib/auth";
import { sseStream, subscribe } from "@/lib/events";
import { sanitizeConversationForVisitor, store } from "@/lib/store";
import type { ConversationWithMessages } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const visitorSessionId = await getOrCreateVisitorSession();
  const conversation = await store.getOrCreateConversation(visitorSessionId);
  const stream = sseStream(sanitizeConversationForVisitor(conversation), (send) =>
    subscribe("conversation", conversation.id, (payload) =>
      send(sanitizeConversationForVisitor(payload as ConversationWithMessages)),
    ),
  );

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
