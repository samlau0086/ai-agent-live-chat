import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function GET() {
  const [widgetConfig, agentStatuses] = await Promise.all([
    store.getWidgetConfiguration(),
    store.listAgentStatuses(),
  ]);

  return NextResponse.json({
    widgetConfig,
    supportOnline: agentStatuses.some((agent) => agent.status === "online"),
  });
}
