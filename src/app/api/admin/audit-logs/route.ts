import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  return NextResponse.json({ auditLogs: await store.listAuditLogs() });
}
