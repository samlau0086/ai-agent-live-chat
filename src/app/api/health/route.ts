import { NextResponse } from "next/server";
import { ensureNotificationScheduler } from "@/lib/notifications";
import { store } from "@/lib/store";

export async function GET() {
  ensureNotificationScheduler();
  const health = await store.getSystemHealth();
  return NextResponse.json(health, { status: health.ok ? 200 : 503 });
}
