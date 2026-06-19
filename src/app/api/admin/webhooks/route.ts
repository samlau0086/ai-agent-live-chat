import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { webhookEvents } from "@/lib/event-contracts";
import { store } from "@/lib/store";
import type { WebhookEvent } from "@/lib/types";

export async function GET() {
  const auth = await requireAdminRequest("admin.webhooks.read");
  if (auth.response) return auth.response;
  return NextResponse.json({
    endpoints: await store.listWebhookEndpoints(),
    deliveries: await store.listWebhookDeliveries(),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminRequest("admin.webhooks.create");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    url?: string;
    secret?: string;
    events?: WebhookEvent[];
    retryMaxAttempts?: number;
    retryBackoffSeconds?: number;
  };
  const name = String(body.name ?? "").trim();
  const url = String(body.url ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
  const validEvents = new Set<WebhookEvent>(webhookEvents);
  const events = (body.events ?? []).filter((event): event is WebhookEvent => validEvents.has(event));
  const endpoint = await store.addWebhookEndpoint({
    name,
    url,
    secret: body.secret,
    events: events.length ? events : ["message.created", "handoff.started", "handoff.released"],
    retryMaxAttempts: body.retryMaxAttempts,
    retryBackoffSeconds: body.retryBackoffSeconds,
  });
  await store.addAuditLog({
    actorId: auth.user.id,
    action: "webhook_endpoint.created",
    targetType: "WebhookEndpoint",
    targetId: endpoint.id,
    metadata: { name, url },
  });
  return NextResponse.json({ endpoint });
}
