import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";
import type { UserRole } from "@/lib/types";

function forbidden() {
  return NextResponse.json({ error: "Admin role required" }, { status: 403 });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getAgent();
  if (!actor) return unauthorized();
  if (actor.role !== "admin") return forbidden();

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    password?: string;
    role?: UserRole;
    disabled?: boolean;
  };
  if (body.password !== undefined && String(body.password).trim().length < 6) {
    return NextResponse.json({ error: "password must be at least 6 characters" }, { status: 400 });
  }

  try {
    const user = await store.updateUser(
      id,
      {
        password: body.password ? String(body.password) : undefined,
        role: body.role,
        disabled: body.disabled,
      },
      actor.id,
    );
    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        disabled: user.disabled,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update user" }, { status: 404 });
  }
}
