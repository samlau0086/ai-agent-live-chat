import { NextResponse } from "next/server";
import { requireIntegrationRequest } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireIntegrationRequest(request, "integrations:knowledge");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const [knowledgeBases, documents, sources, embeddings] = await Promise.all([
    store.listKnowledgeBases(),
    store.listKnowledgeDocuments(id),
    store.listKnowledgeSources(id),
    store.listKnowledgeEmbeddings(id),
  ]);
  const knowledgeBase = knowledgeBases.find((item) => item.id === id);
  if (!knowledgeBase) return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });
  return NextResponse.json({ knowledgeBase, documents, sources, embeddings });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireIntegrationRequest(request, "integrations:knowledge");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    enabled?: boolean;
  };
  try {
    const knowledgeBase = await store.updateKnowledgeBase(id, {
      name: body.name === undefined ? undefined : String(body.name).trim(),
      description: body.description,
      enabled: body.enabled,
    });
    return NextResponse.json({ knowledgeBase });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Knowledge base not found" }, { status: 404 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireIntegrationRequest(request, "integrations:knowledge");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  try {
    await store.deleteKnowledgeBase(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Knowledge base not found" }, { status: 404 });
  }
}

