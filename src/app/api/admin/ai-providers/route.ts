import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { aiProviderRegistry } from "@/lib/ai-providers";

export async function GET() {
  const auth = await requireAdminRequest("admin.ai_providers.read");
  if (auth.response) return auth.response;
  return NextResponse.json({ providers: aiProviderRegistry });
}
