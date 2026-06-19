import { hmac, safeEqual } from "./crypto";
import { webhookEnvelope } from "./event-contracts";
import { store } from "./store";
import type { WebhookEndpoint, WebhookEvent } from "./types";

export function signWebhookPayload(payload: string, secret = process.env.WEBHOOK_SIGNING_SECRET ?? "dev-webhook-secret") {
  return hmac(payload, secret);
}

export function verifyWebhookSignature(payload: string, signature: string) {
  return safeEqual(signWebhookPayload(payload), signature);
}

async function deliverWebhook(endpoint: WebhookEndpoint, event: WebhookEvent, payload: unknown, attempts = 1) {
  const body = JSON.stringify(webhookEnvelope(event, payload));
  try {
    const signature = signWebhookPayload(body, endpoint.secret);
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Live-Chat-Signature": signature,
      },
      body,
    });
    return store.addWebhookDelivery({
      endpointId: endpoint.id,
      event,
      payload,
      status: response.ok ? "sent" : "failed",
      attempts,
      lastError: response.ok ? undefined : `HTTP ${response.status}`,
    });
  } catch (error) {
    return store.addWebhookDelivery({
      endpointId: endpoint.id,
      event,
      payload,
      status: "failed",
      attempts,
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function emitWebhook(event: WebhookEvent, payload: unknown) {
  const endpoints = await store.listWebhookEndpoints();
  await Promise.all(
    endpoints
      .filter((endpoint: WebhookEndpoint) => endpoint.events.includes(event))
      .map((endpoint: WebhookEndpoint) => deliverWebhook(endpoint, event, payload)),
  );
}

export async function replayWebhookDelivery(deliveryId: string) {
  const delivery = await store.getWebhookDelivery(deliveryId);
  if (!delivery) throw new Error("Webhook delivery not found");
  const endpoint = await store.getWebhookEndpoint(delivery.endpointId);
  if (!endpoint) throw new Error("Webhook endpoint not found");
  if (!endpoint.enabled) throw new Error("Webhook endpoint is disabled");
  if (!endpoint.events.includes(delivery.event)) throw new Error("Webhook endpoint is not subscribed to this event");
  return deliverWebhook(endpoint, delivery.event, delivery.payload, delivery.attempts + 1);
}
