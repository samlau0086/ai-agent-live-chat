import { NextResponse } from "next/server";
import { requireActiveAgentRequest } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  const auth = await requireActiveAgentRequest("agent.agents.read");
  if (auth.response) return auth.response;

  const [users, statuses] = await Promise.all([store.listUsers(), store.listAgentStatuses()]);
  const agents = users
    .filter((user) => !user.disabled && ["admin", "agent"].includes(user.role))
    .map((user) => {
      const status = statuses.find((item) => item.userId === user.id);
      return {
        id: user.id,
        username: user.username,
        role: user.role,
        status: status?.status ?? "offline",
        statusUpdatedAt: status?.updatedAt,
      };
    });

  return NextResponse.json({ agents });
}
