import { NextResponse } from "next/server";
import { requireRoleRequest } from "@/lib/auth";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import type { ConversationTag, CustomerProfile } from "@/lib/types";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleRequest(["admin", "agent"], "agent.conversations.operations.update");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    tags?: ConversationTag[];
    customerProfile?: CustomerProfile;
    quickReplies?: string[];
    translation?: { enabled?: boolean; visitorLanguage?: string };
  };
  const existing = await store.getConversation(id);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const metadata: Record<string, unknown> = {};
  if (Array.isArray(body.tags)) {
    metadata.tags = body.tags
      .map((tag) => ({
        name: String(tag.name ?? "").trim(),
        color: tag.color ? String(tag.color).trim() : undefined,
      }))
      .filter((tag) => tag.name);
  }
  if (body.customerProfile && typeof body.customerProfile === "object") {
    metadata.customerProfile = {
      name: body.customerProfile.name ? String(body.customerProfile.name).trim() : undefined,
      email: body.customerProfile.email ? String(body.customerProfile.email).trim() : undefined,
      externalId: body.customerProfile.externalId ? String(body.customerProfile.externalId).trim() : undefined,
      plan: body.customerProfile.plan ? String(body.customerProfile.plan).trim() : undefined,
      notes: body.customerProfile.notes ? String(body.customerProfile.notes).trim() : undefined,
    };
  }
  if (Array.isArray(body.quickReplies)) {
    metadata.quickReplies = body.quickReplies.map((item) => String(item).trim()).filter(Boolean);
  }
  if (body.translation && typeof body.translation === "object") {
    metadata.translation = {
      ...((existing.metadata.translation && typeof existing.metadata.translation === "object"
        ? existing.metadata.translation
        : {}) as Record<string, unknown>),
      ...(typeof body.translation.enabled === "boolean" ? { enabled: body.translation.enabled } : {}),
      ...(body.translation.visitorLanguage
        ? { visitorLanguage: String(body.translation.visitorLanguage).trim() }
        : {}),
    };
  }

  const conversation = await store.mergeConversationMetadata(id, metadata);
  publishConversation(conversation);
  return NextResponse.json({ conversation });
}
