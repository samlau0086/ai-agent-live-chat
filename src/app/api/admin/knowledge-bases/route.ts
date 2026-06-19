import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  const auth = await requireAdminRequest("admin.knowledge_bases.read");
  if (auth.response) return auth.response;

  const knowledgeBases = await store.listKnowledgeBases();
  const sources = await store.listKnowledgeSources();
  const documents = await store.listKnowledgeDocuments();
  const embeddings = await store.listKnowledgeEmbeddings();
  return NextResponse.json({ knowledgeBases, sources, documents, embeddings });
}

export async function POST(request: Request) {
  const auth = await requireAdminRequest("admin.knowledge_bases.create");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string; enabled?: boolean };
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const knowledgeBase = await store.createKnowledgeBase(
    { name, description: body.description, enabled: body.enabled },
    auth.user.id,
  );
  return NextResponse.json({ knowledgeBase });
}
