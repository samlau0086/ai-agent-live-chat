import { NextResponse } from "next/server";
import { requireRoleRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { AnalyticsFilters, ConversationStatus } from "@/lib/types";

const statuses: ConversationStatus[] = ["ai_active", "queued_for_human", "human_active", "resolved", "closed"];

function optionalParam(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim();
  return value || undefined;
}

function parseFilters(request: Request): AnalyticsFilters {
  const url = new URL(request.url);
  const status = optionalParam(url, "status");
  return {
    dateFrom: optionalParam(url, "dateFrom"),
    dateTo: optionalParam(url, "dateTo"),
    agentId: optionalParam(url, "agentId"),
    channel: optionalParam(url, "channel"),
    tag: optionalParam(url, "tag"),
    status: status && statuses.includes(status as ConversationStatus) ? (status as ConversationStatus) : undefined,
    knowledgeBaseId: optionalParam(url, "knowledgeBaseId"),
  };
}

export async function GET(request: Request) {
  const auth = await requireRoleRequest(["admin", "viewer"], "admin.metrics.read");
  if (auth.response) return auth.response;
  return NextResponse.json({ metrics: await store.getMetrics(parseFilters(request)) });
}
