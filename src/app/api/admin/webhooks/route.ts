import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";
import type { WebhookEvent } from "@/lib/types";

function forbidden() {
  return NextResponse.json({ error: "Admin role required" }, { status: 403 });
}

export async function GET() {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();
  return NextResponse.json({
    endpoints: await store.listWebhookEndpoints(),
    deliveries: await store.listWebhookDeliveries(),
  });
}

export async function POST(request: Request) {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    url?: string;
    secret?: string;
    events?: WebhookEvent[];
  };
  const name = String(body.name ?? "").trim();
  const url = String(body.url ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
  const endpoint = await store.addWebhookEndpoint({
    name,
    url,
    secret: body.secret,
    events: body.events?.length ? body.events : ["message.created", "handoff.started", "handoff.released"],
  });
  await store.addAuditLog({
    actorId: user.id,
    action: "webhook_endpoint.created",
    targetType: "WebhookEndpoint",
    targetId: endpoint.id,
    metadata: { name, url },
  });
  return NextResponse.json({ endpoint });
}
