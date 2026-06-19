import { NextResponse } from "next/server";
import { requireRoleRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { AgentStatus } from "@/lib/types";

const validStatuses: AgentStatus["status"][] = ["online", "away", "offline"];

export async function PUT(request: Request) {
  const auth = await requireRoleRequest(["admin", "agent"], "agent.status.update");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { status?: AgentStatus["status"] };
  const status = body.status && validStatuses.includes(body.status) ? body.status : undefined;
  if (!status) return NextResponse.json({ error: "valid status is required" }, { status: 400 });

  const agentStatus = await store.setAgentStatus(auth.user.id, status);
  return NextResponse.json({ agentStatus });
}
