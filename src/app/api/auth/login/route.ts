import { NextResponse } from "next/server";
import { login, setAgentSession } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const user = await login(String(body.username ?? ""), String(body.password ?? ""));
  if (!user) return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });

  await setAgentSession(user);
  return NextResponse.json({ user });
}
