import { NextResponse } from "next/server";
import { publishConversation } from "@/lib/events";
import { store } from "@/lib/store";
import type { CustomerProfile } from "@/lib/types";
import { verifyWebhookSignature } from "@/lib/webhooks";

const profileFields = ["name", "email", "externalId", "plan", "notes"] as const;

function sanitizeProfile(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Partial<Record<(typeof profileFields)[number], unknown>>;
  const profile: Partial<CustomerProfile> = {};
  for (const field of profileFields) {
    if (source[field] === undefined || source[field] === null) continue;
    const value = String(source[field]).trim();
    if (value) profile[field] = value;
  }
  return profile;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-live-chat-signature") ?? "")) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { id } = await context.params;
  let body: { profile?: CustomerProfile; externalUserId?: string; metadata?: Record<string, unknown> };
  try {
    body = JSON.parse(raw || "{}") as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await store.getConversation(id);
  if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const profile = sanitizeProfile(body.profile);
  const externalUserId = String(body.externalUserId ?? "").trim();
  const hasMetadata = Boolean(body.metadata && Object.keys(body.metadata).length > 0);
  if (!Object.keys(profile).length && !externalUserId && !hasMetadata) {
    return NextResponse.json({ error: "profile, externalUserId, or metadata is required" }, { status: 400 });
  }

  const metadata = {
    ...(body.metadata ?? {}),
    customerProfile: {
      ...(existing.customerProfile ?? {}),
      ...profile,
    },
  };
  const conversation = externalUserId
    ? await store.bindConversationExternalUser(id, externalUserId, metadata)
    : await store.mergeConversationMetadata(id, metadata);

  publishConversation(conversation);
  return NextResponse.json({ conversation });
}
