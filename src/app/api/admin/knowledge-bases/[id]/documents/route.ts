import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { extractUploadedKnowledgeSource, fetchUrlKnowledgeSource, normalizeKnowledgeSourceType } from "@/lib/knowledge-import";
import { store } from "@/lib/store";
import type { KnowledgeDocument } from "@/lib/types";

type DocumentImportInput = {
  title?: string;
  content?: string;
  sourceType?: KnowledgeDocument["sourceType"];
  sourceUri?: string;
  enabled?: boolean;
  file?: File;
};

async function parseDocumentImportRequest(request: Request): Promise<DocumentImportInput> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    return {
      title: String(form.get("title") ?? ""),
      content: String(form.get("content") ?? ""),
      sourceType: normalizeKnowledgeSourceType(form.get("sourceType")),
      sourceUri: String(form.get("sourceUri") ?? ""),
      enabled: form.get("enabled") === null ? undefined : String(form.get("enabled")) !== "false",
      file: file instanceof File ? file : undefined,
    };
  }
  return (await request.json().catch(() => ({}))) as DocumentImportInput;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.knowledge_documents.create");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = await parseDocumentImportRequest(request);
  const sourceType = normalizeKnowledgeSourceType(body.sourceType);
  const sourceUri = String(body.sourceUri ?? "").trim() || undefined;
  let title = String(body.title ?? "").trim();
  let content = String(body.content ?? "").trim();

  try {
    if (sourceType === "url") {
      if (!sourceUri) return NextResponse.json({ error: "sourceUri is required for url sources" }, { status: 400 });
      const fetched = await fetchUrlKnowledgeSource(sourceUri);
      title = title || fetched.title || sourceUri;
      content = fetched.content;
    } else if (sourceType === "pdf" || sourceType === "docx") {
      if (!body.file) return NextResponse.json({ error: "file is required for PDF/Docx sources" }, { status: 400 });
      const extracted = await extractUploadedKnowledgeSource(body.file, sourceType);
      title = title || body.file.name;
      content = extracted.content;
    } else if (sourceType === "external") {
      return NextResponse.json({ error: "external sources must use the signed integration sync API" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to import source" }, { status: 400 });
  }

  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

  try {
    const document = await store.createKnowledgeDocument(
      { knowledgeBaseId: id, title, content, sourceType, sourceUri, enabled: body.enabled },
      auth.user.id,
    );
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create document" }, { status: 404 });
  }
}
