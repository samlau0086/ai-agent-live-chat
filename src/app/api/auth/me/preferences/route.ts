import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";
import type { AppLocale } from "@/lib/types";

export async function PUT(request: Request) {
  const sessionUser = await getAgent();
  if (!sessionUser) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { locale?: AppLocale };
  const locale = body.locale === "zh" ? "zh" : body.locale === "en" ? "en" : undefined;
  if (!locale) return NextResponse.json({ error: "locale must be en or zh" }, { status: 400 });

  const user = await store.updateUser(sessionUser.id, { locale }, sessionUser.id);
  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      locale: user.locale,
      forcePasswordChange: user.forcePasswordChange,
    },
  });
}
