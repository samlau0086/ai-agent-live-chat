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
  const scopes = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  return scopes.filter((scope) => allowedScopes.has(scope));
}

export async function GET() {
  const auth = await requireAdminRequest("admin.api_tokens.read");
  if (auth.response) return auth.response;
  const tokens = await store.listApiTokens();
  return NextResponse.json({ tokens: tokens.map(publicToken), allowedScopes: [...allowedScopes] });
}

export async function POST(request: Request) {
  const auth = await requireAdminRequest("admin.api_tokens.create");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    scopes?: string[];
    expiresAt?: string;
  };
  const name = String(body.name ?? "").trim();
  const scopes = normalizeScopes(body.scopes);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!scopes.length) return NextResponse.json({ error: "at least one valid scope is required" }, { status: 400 });

  const created = await store.createApiToken(
    {
      name,
      scopes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : undefined,
    },
    auth.user.id,
  );
  return NextResponse.json({ apiToken: publicToken(created.apiToken), token: created.token });
}
