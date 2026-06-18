import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";

function forbidden() {
  return NextResponse.json({ error: "Admin role required" }, { status: 403 });
}

export async function GET() {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const knowledgeBases = await store.listKnowledgeBases();
  const documents = await store.listKnowledgeDocuments();
  return NextResponse.json({ knowledgeBases, documents });
}

export async function POST(request: Request) {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string; enabled?: boolean };
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const knowledgeBase = await store.createKnowledgeBase(
    { name, description: body.description, enabled: body.enabled },
    user.id,
  );
  return NextResponse.json({ knowledgeBase });
}
