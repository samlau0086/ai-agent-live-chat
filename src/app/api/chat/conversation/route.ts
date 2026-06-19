import { NextResponse } from "next/server";
import { getOrCreateVisitorSession } from "@/lib/auth";
import { sanitizeConversationForVisitor, store } from "@/lib/store";

export async function GET() {
  const visitorSessionId = await getOrCreateVisitorSession();
  const conversation = await store.getOrCreateConversation(visitorSessionId);
  return NextResponse.json({ conversation: sanitizeConversationForVisitor(conversation) });
}
