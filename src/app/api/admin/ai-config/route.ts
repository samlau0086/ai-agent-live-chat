import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { AIConfiguration } from "@/lib/types";

export async function GET() {
  const auth = await requireAdminRequest("admin.ai_config.read");
  if (auth.response) return auth.response;
  return NextResponse.json({ aiConfig: await store.getAIConfiguration() });
}

export async function PUT(request: Request) {
  const auth = await requireAdminRequest("admin.ai_config.update");
  if (auth.response) return auth.response;

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
      noAnswerStrategy: body.noAnswerStrategy ?? current.noAnswerStrategy,
      enableKnowledgeBase: Boolean(body.enableKnowledgeBase ?? current.enableKnowledgeBase),
      enableTools: Boolean(body.enableTools ?? current.enableTools),
      knowledgeBaseIds: Array.isArray(body.knowledgeBaseIds) ? body.knowledgeBaseIds : current.knowledgeBaseIds,
      translationEnabled: Boolean(body.translationEnabled ?? current.translationEnabled),
      translationProvider: body.translationProvider ?? current.translationProvider,
      translationModel: String(body.translationModel ?? current.translationModel),
      agentLanguage: body.agentLanguage ?? current.agentLanguage,
      autoHandoff: body.autoHandoff ?? current.autoHandoff,
    },
    auth.user.id,
  );
  return NextResponse.json({ aiConfig: updated });
}
