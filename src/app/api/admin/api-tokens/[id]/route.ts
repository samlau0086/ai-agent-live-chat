import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { ApiToken } from "@/lib/types";

const allowedScopes = new Set([
  "*",
  "integrations:conversations",
  "integrations:messages",
  "integrations:knowledge",
  "integrations:webhooks",
]);

function publicToken(token: ApiToken) {
  return {
    id: token.id,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    scopes: token.scopes,
    disabled: token.disabled,
    expiresAt: token.expiresAt,
    lastUsedAt: token.lastUsedAt,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt,
  };
}

function normalizeScopes(value: unknown) {
  if (value === undefined) return undefined;
  const scopes = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  return scopes.filter((scope) => allowedScopes.has(scope));
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.api_tokens.update");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    scopes?: string[];
    disabled?: boolean;
    expiresAt?: string | null;
  };
  try {
    const apiToken = await store.updateApiToken(
      id,
      {
        name: body.name === undefined ? undefined : String(body.name).trim(),
        scopes: normalizeScopes(body.scopes),
        disabled: body.disabled,
        expiresAt: body.expiresAt === undefined ? undefined : body.expiresAt ? new Date(body.expiresAt).toISOString() : undefined,
      },
      auth.user.id,
    );
    return NextResponse.json({ apiToken: publicToken(apiToken) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "API token not found" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.api_tokens.delete");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  try {
    await store.deleteApiToken(id, auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "API token not found" }, { status: 404 });
  }
}
