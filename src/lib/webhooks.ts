import { hmac, safeEqual } from "./crypto";
import { store } from "./store";
import type { WebhookEvent } from "./types";

export function signWebhookPayload(payload: string, secret = process.env.WEBHOOK_SIGNING_SECRET ?? "dev-webhook-secret") {
  return hmac(payload, secret);
}

export function verifyWebhookSignature(payload: string, signature: string) {
  return safeEqual(signWebhookPayload(payload), signature);
}

export async function emitWebhook(event: WebhookEvent, payload: unknown) {
  const endpoints = await store.listWebhookEndpoints();
  const body = JSON.stringify({ event, payload, occurredAt: new Date().toISOString() });
  await Promise.all(
    endpoints
      .filter((endpoint) => endpoint.events.includes(event))
      .map(async (endpoint) => {
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
          await store.addWebhookDelivery({
            endpointId: endpoint.id,
            event,
            payload,
            status: response.ok ? "sent" : "failed",
            attempts: 1,
            lastError: response.ok ? undefined : `HTTP ${response.status}`,
          });
        } catch (error) {
          await store.addWebhookDelivery({
            endpointId: endpoint.id,
            event,
            payload,
            status: "failed",
            attempts: 1,
            lastError: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }),
  );
}
