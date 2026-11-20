import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const db = getDb();
  const requests = db
    .prepare(
      `
      SELECT
        r.id,
        r.user_id,
        u.name AS user_name,
        u.username AS user_username,
        u.role AS user_role,
        r.old_whatsapp,
        r.new_whatsapp,
        r.status,
        r.reject_reason,
        r.created_at,
        r.reviewed_at
      FROM phone_change_requests r
      JOIN users u ON u.id = r.user_id
      ORDER BY
        CASE r.status WHEN 'PENDING' THEN 1 ELSE 2 END,
        r.created_at DESC
      LIMIT 50
      `
    )
    .all();

  return Response.json({ requests });
}
