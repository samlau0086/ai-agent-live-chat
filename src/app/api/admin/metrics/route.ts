import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (!["admin", "viewer"].includes(user.role)) {
    return NextResponse.json({ error: "Admin or viewer role required" }, { status: 403 });
  }
  return NextResponse.json({ metrics: await store.getMetrics() });
}
