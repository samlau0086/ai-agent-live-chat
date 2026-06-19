import { NextResponse } from "next/server";
import { requireActiveAgentRequest } from "@/lib/auth";
import { sseStream, subscribe } from "@/lib/events";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireActiveAgentRequest("agent.conversations.read");
  if (auth.response) return auth.response;
  const url = new URL(request.url);

  if (url.searchParams.get("stream") === "1") {
    const conversations = await store.listConversations();
    const stream = sseStream({ conversations }, (send) => subscribe("conversations", undefined, send));
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  return NextResponse.json({ conversations: await store.listConversations() });
}
