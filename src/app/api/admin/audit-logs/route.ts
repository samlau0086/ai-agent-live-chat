import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  const auth = await requireAdminRequest("admin.audit_logs.read");
  if (auth.response) return auth.response;
  return NextResponse.json({ auditLogs: await store.listAuditLogs() });
}

export async function DELETE() {
  const auth = await requireAdminRequest("admin.audit_logs.delete");
  if (auth.response) return auth.response;

  const deletedCount = await store.clearAuditLogs();
  return NextResponse.json({ deletedCount });
}
