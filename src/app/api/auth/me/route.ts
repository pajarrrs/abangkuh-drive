import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import type { PhoneChangeRequest } from "@/lib/types";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ user: null });
  }

  const db = getDb();
  const latestPhoneRequest = db
    .prepare(
      `SELECT id, user_id, old_whatsapp, new_whatsapp, status, reject_reason, created_at, reviewed_at
       FROM phone_change_requests
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(user.id) as unknown as PhoneChangeRequest | undefined;

  return Response.json({
    user: {
      ...user,
      latest_phone_request: latestPhoneRequest ?? null,
    },
  });
}
