import { NextResponse } from "next/server";
import { requireIntegrationRequest } from "./auth";
import { verifyWebhookSignature } from "./webhooks";

type IntegrationAuthorizationResult = { response?: NextResponse };

export async function authorizeIntegrationRequest(
  request: Request,
  scope: string,
  rawBody?: string,
): Promise<IntegrationAuthorizationResult> {
  if ((request.headers.get("authorization") ?? "").match(/^Bearer\s+/i)) {
    return requireIntegrationRequest(request, scope);
  }

  if (rawBody !== undefined && verifyWebhookSignature(rawBody, request.headers.get("x-live-chat-signature") ?? "")) {
    return {};
  }

  return { response: NextResponse.json({ error: "Invalid integration authentication" }, { status: 401 }) };
}
