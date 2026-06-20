import { NextResponse } from "next/server";
import { requireIntegrationRequest } from "@/lib/auth";
import { authorizeIntegrationRequest } from "@/lib/integration-auth";
import { store } from "@/lib/store";

type ExternalKnowledgeDocumentBody = {
  title?: string;
  content?: string;
  sourceUri?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
  enabled?: boolean;
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireIntegrationRequest(request, "integrations:knowledge");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const [documents, sources, embeddings] = await Promise.all([
    store.listKnowledgeDocuments(id),
    store.listKnowledgeSources(id),
    store.listKnowledgeEmbeddings(id),
  ]);
  return NextResponse.json({ documents, sources, embeddings });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const raw = await request.text();
  const auth = await authorizeIntegrationRequest(request, "integrations:knowledge", raw);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  let body: ExternalKnowledgeDocumentBody;
  try {
    body = JSON.parse(raw || "{}") as ExternalKnowledgeDocumentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  const content = String(body.content ?? "").trim();
  const sourceUri = String(body.sourceUri ?? "").trim() || undefined;
  const externalId = String(body.externalId ?? "").trim() || undefined;
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

  try {
    const sourceMetadata = {
      ...(body.metadata ?? {}),
      ...(externalId ? { externalId } : {}),
      source: "integration",
    };
    const document = await store.createKnowledgeDocument({
      knowledgeBaseId: id,
      title,
      content,
      sourceType: "external",
      sourceUri,
      sourceMetadata,
      enabled: body.enabled,
    });
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync external document" },
      { status: 404 },
    );
  }
}
