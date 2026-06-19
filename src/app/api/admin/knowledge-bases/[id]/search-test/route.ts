import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { KnowledgeSearchOptions, KnowledgeSource } from "@/lib/types";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.knowledge_bases.search_test");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Partial<KnowledgeSearchOptions>;
  const query = String(body.query ?? "").trim();
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });
  const sourceTypes = Array.isArray(body.sourceTypes)
    ? body.sourceTypes.filter((item): item is KnowledgeSource["type"] =>
        ["manual", "markdown", "text", "pdf", "docx", "url", "external"].includes(String(item)),
      )
    : undefined;
  return NextResponse.json({
    results: await store.searchKnowledge({
      query,
      knowledgeBaseIds: [id],
      topK: body.topK,
      sourceTypes,
      keywordWeight: body.keywordWeight,
      vectorWeight: body.vectorWeight,
      minScore: body.minScore,
      candidateMultiplier: body.candidateMultiplier,
    }),
  });
}
