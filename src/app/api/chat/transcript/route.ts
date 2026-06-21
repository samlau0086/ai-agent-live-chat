import { NextResponse } from "next/server";
import { getVisitorSession } from "@/lib/auth";
import { sanitizeConversationForVisitor, store } from "@/lib/store";
import { conversationTranscriptText } from "@/lib/transcript";

export async function GET() {
  const visitorSessionId = await getVisitorSession();
  if (!visitorSessionId) return NextResponse.json({ error: "No visitor session" }, { status: 404 });

  const existing = await store.getConversationByVisitorSession(visitorSessionId);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const conversation = sanitizeConversationForVisitor(existing);

  return new NextResponse(conversationTranscriptText(conversation), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="live-chat-${conversation.id}.txt"`,
    },
  });
}
