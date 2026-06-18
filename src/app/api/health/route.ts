import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function GET() {
  const aiConfig = await store.getAIConfiguration();
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    storage: "file-store",
    aiProvider: aiConfig.provider,
  });
}
