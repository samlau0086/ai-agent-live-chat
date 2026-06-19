import { NextResponse } from "next/server";
import { getVisitorSession } from "@/lib/auth";
import { sanitizeConversationForVisitor, store } from "@/lib/store";

function roleLabel(role: string) {
  if (role === "visitor") return "Visitor";
  if (role === "human_agent") return "Agent";
  if (role === "ai") return "AI";
  if (role === "system") return "System";
  return role;
}

export async function GET() {
  const visitorSessionId = await getVisitorSession();
  if (!visitorSessionId) return NextResponse.json({ error: "No visitor session" }, { status: 404 });

  const existing = await store.getConversationByVisitorSession(visitorSessionId);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const conversation = sanitizeConversationForVisitor(existing);
  const lines = [
    "AI Agent Live Chat Transcript",
    `Conversation: ${conversation.id}`,
    `Status: ${conversation.status}`,
    `Created: ${conversation.createdAt}`,
    "",
    ...conversation.messages.map(
      (message) => `[${message.createdAt}] ${roleLabel(message.role)}: ${message.content}`,
    ),
    "",
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="live-chat-${conversation.id}.txt"`,
    },
  });
}
