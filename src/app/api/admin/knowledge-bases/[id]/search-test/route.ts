import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";

function forbidden() {
  return NextResponse.json({ error: "Admin role required" }, { status: 403 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { query?: string; topK?: number };
  const query = String(body.query ?? "").trim();
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });
  return NextResponse.json({
    results: await store.searchKnowledge({ query, knowledgeBaseIds: [id], topK: body.topK ?? 5 }),
  });
}
