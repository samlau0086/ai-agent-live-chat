import { NextResponse } from "next/server";
import { requireIntegrationRequest } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET(request: Request) {
  const auth = await requireIntegrationRequest(request, "integrations:knowledge");
  if (auth.response) return auth.response;

  const knowledgeBases = await store.listKnowledgeBases();
  return NextResponse.json({ knowledgeBases });
}

export async function POST(request: Request) {
  const auth = await requireIntegrationRequest(request, "integrations:knowledge");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    enabled?: boolean;
  };
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const knowledgeBase = await store.createKnowledgeBase({
    name,
    description: body.description,
    enabled: body.enabled,
  });
  return NextResponse.json({ knowledgeBase });
}

