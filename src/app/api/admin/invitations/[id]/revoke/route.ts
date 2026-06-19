import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.invitations.revoke");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  try {
    const invitation = await store.revokeUserInvitation(id, auth.user.id);
    return NextResponse.json({
      invitation: {
        id: invitation.id,
        username: invitation.username,
        role: invitation.role,
        invitedById: invitation.invitedById,
        acceptedUserId: invitation.acceptedUserId,
        expiresAt: invitation.expiresAt,
        acceptedAt: invitation.acceptedAt,
        revokedAt: invitation.revokedAt,
        createdAt: invitation.createdAt,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to revoke invitation" },
      { status: 404 },
    );
  }
}
