import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  const auth = await requireAdminRequest("admin.knowledge_documents.read");
  if (auth.response) return auth.response;

  const { id, documentId } = await context.params;
  const document = (await store.listKnowledgeDocuments(id)).find((item) => item.id === documentId);
  if (!document) return NextResponse.json({ error: "Knowledge document not found" }, { status: 404 });
  return NextResponse.json({ document });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string; documentId: string }> }) {
  const auth = await requireAdminRequest("admin.knowledge_documents.update");
  if (auth.response) return auth.response;

  const { documentId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    content?: string;
    enabled?: boolean;
    sourceUri?: string;
    sourceMetadata?: Record<string, unknown>;
  };
  try {
    const document = await store.updateKnowledgeDocument(
      documentId,
      {
        title: body.title === undefined ? undefined : String(body.title).trim(),
        content: body.content === undefined ? undefined : String(body.content),
        enabled: body.enabled,
        sourceUri: body.sourceUri,
        sourceMetadata: body.sourceMetadata,
      },
      auth.user.id,
    );
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Knowledge document not found" },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  const auth = await requireAdminRequest("admin.knowledge_documents.delete");
  if (auth.response) return auth.response;

  const { documentId } = await context.params;
  try {
    await store.deleteKnowledgeDocument(documentId, auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Knowledge document not found" },
      { status: 404 },
    );
  }
}

