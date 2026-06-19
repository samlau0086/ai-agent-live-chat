import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.knowledge_bases.reindex");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  try {
    const knowledgeBase = await store.reindexKnowledgeBase(id, auth.user.id);
    return NextResponse.json({ knowledgeBase });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reindex" }, { status: 404 });
  }
}
