import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";
import type { AIConfiguration } from "@/lib/types";

function forbidden() {
  return NextResponse.json({ error: "Admin role required" }, { status: 403 });
}

export async function GET() {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();
  return NextResponse.json({ aiConfig: await store.getAIConfiguration() });
}

export async function PUT(request: Request) {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const body = (await request.json().catch(() => ({}))) as Partial<AIConfiguration>;
  const current = await store.getAIConfiguration();
  const updated = await store.updateAIConfiguration(
    {
      provider: body.provider ?? current.provider,
      model: body.model ?? current.model,
      temperature: Number(body.temperature ?? current.temperature),
      maxContextMessages: Number(body.maxContextMessages ?? current.maxContextMessages),
      systemPrompt: String(body.systemPrompt ?? current.systemPrompt),
      fallbackMessage: String(body.fallbackMessage ?? current.fallbackMessage),
      enableKnowledgeBase: Boolean(body.enableKnowledgeBase ?? current.enableKnowledgeBase),
      enableTools: Boolean(body.enableTools ?? current.enableTools),
      knowledgeBaseIds: Array.isArray(body.knowledgeBaseIds) ? body.knowledgeBaseIds : current.knowledgeBaseIds,
      autoHandoff: body.autoHandoff ?? current.autoHandoff,
    },
    user.id,
  );
  return NextResponse.json({ aiConfig: updated });
}
