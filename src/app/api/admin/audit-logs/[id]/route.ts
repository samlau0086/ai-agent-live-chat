import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireAdminRequest("admin.audit_logs.delete");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const deleted = await store.deleteAuditLog(id);
  if (!deleted) return NextResponse.json({ error: "Audit log not found." }, { status: 404 });

  return NextResponse.json({ deleted: true });
}
