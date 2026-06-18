import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";

function forbidden() {
  return NextResponse.json({ error: "Admin role required" }, { status: 403 });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const { id } = await context.params;
  try {
    const knowledgeBase = await store.reindexKnowledgeBase(id, user.id);
    return NextResponse.json({ knowledgeBase });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reindex" }, { status: 404 });
  }
}
