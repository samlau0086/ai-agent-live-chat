import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { verifyWebhookSignature } from "@/lib/webhooks";

type ExternalKnowledgeDocumentBody = {
  title?: string;
  content?: string;
  sourceUri?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
  enabled?: boolean;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-live-chat-signature") ?? "")) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

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
