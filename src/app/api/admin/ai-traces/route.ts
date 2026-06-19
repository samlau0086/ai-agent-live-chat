import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET(request: Request) {
  const auth = await requireAdminRequest("admin.ai_traces.read");
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const traces = await store.listAITraces(limit);
  return NextResponse.json({ traces });
}
