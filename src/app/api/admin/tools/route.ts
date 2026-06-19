import { NextResponse } from "next/server";
import { requireAdminRequest, requireRoleRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import { builtInTools, listConfiguredTools } from "@/lib/tools";
import type { ToolDefinition } from "@/lib/types";

export async function GET() {
  const auth = await requireRoleRequest(["admin", "agent", "viewer"], "admin.tools.read");
  if (auth.response) return auth.response;
  const tools = await listConfiguredTools();
  return NextResponse.json({
    tools: tools.map(({ name, description, parameters, inputSchema, authConfig, timeoutMs, enabled, permissionScope }) => ({
      name,
      description,
      parameters,
      inputSchema,
      authConfig,
      timeoutMs,
      enabled,
      permissionScope,
      runtimeImplemented: builtInTools.some((tool) => tool.name === name),
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminRequest("admin.tools.upsert");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Partial<ToolDefinition>;
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const tool = await store.upsertToolDefinition(
    {
      name,
      description: body.description,
      inputSchema: body.inputSchema,
      authConfig: body.authConfig,
      timeoutMs: body.timeoutMs,
      enabled: body.enabled,
      permissionScope: body.permissionScope,
    },
    auth.user.id,
  );
  return NextResponse.json({ tool });
}
