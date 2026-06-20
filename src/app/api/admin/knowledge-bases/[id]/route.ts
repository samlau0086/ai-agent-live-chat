import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.knowledge_bases.read");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const [knowledgeBases, sources, documents, embeddings] = await Promise.all([
    store.listKnowledgeBases(),
    store.listKnowledgeSources(id),
    store.listKnowledgeDocuments(id),
    store.listKnowledgeEmbeddings(id),
  ]);
  const knowledgeBase = knowledgeBases.find((item) => item.id === id);
  if (!knowledgeBase) return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });
  return NextResponse.json({ knowledgeBase, sources, documents, embeddings });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.knowledge_bases.update");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    enabled?: boolean;
  };
  try {
    const knowledgeBase = await store.updateKnowledgeBase(
      id,
      {
        name: body.name === undefined ? undefined : String(body.name).trim(),
        description: body.description,
        enabled: body.enabled,
      },
      auth.user.id,
    );
    return NextResponse.json({ knowledgeBase });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Knowledge base not found" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.knowledge_bases.delete");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  try {
    await store.deleteKnowledgeBase(id, auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Knowledge base not found" }, { status: 404 });
  }
}

