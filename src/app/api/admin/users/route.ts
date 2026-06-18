import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";
import type { User, UserRole } from "@/lib/types";

function forbidden() {
  return NextResponse.json({ error: "Admin role required" }, { status: 403 });
}

function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
  };
}

export async function GET() {
  const user = await getAgent();
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();
  return NextResponse.json({ users: (await store.listUsers()).map(publicUser) });
}

export async function POST(request: Request) {
  const actor = await getAgent();
  if (!actor) return unauthorized();
  if (actor.role !== "admin") return forbidden();

  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    role?: UserRole;
    disabled?: boolean;
  };
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "").trim();
  if (!username) return NextResponse.json({ error: "username is required" }, { status: 400 });
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "password must be at least 6 characters" }, { status: 400 });
  }

  try {
    const user = await store.createUser(
      {
        username,
        password,
        role: body.role ?? "agent",
        disabled: body.disabled,
      },
      actor.id,
    );
    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create user" }, { status: 400 });
  }
}
