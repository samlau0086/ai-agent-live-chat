import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function GET() {
  const health = await store.getSystemHealth();
  return NextResponse.json(health, { status: health.ok ? 200 : 503 });
}
