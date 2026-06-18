import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";
import type { KnowledgeDocument } from "@/lib/types";

function forbidden() {
  return NextResponse.json({ error: "Admin role required" }, { status: 403 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    content?: string;
    sourceType?: KnowledgeDocument["sourceType"];
    enabled?: boolean;
  };
  const title = String(body.title ?? "").trim();
  const content = String(body.content ?? "").trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

  try {
    const document = await store.createKnowledgeDocument(
      { knowledgeBaseId: id, title, content, sourceType: body.sourceType, enabled: body.enabled },
      user.id,
    );
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create document" }, { status: 404 });
  }
}
