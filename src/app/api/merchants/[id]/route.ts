import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const merchantId = Number(id);
  if (!Number.isInteger(merchantId) || merchantId <= 0) {
    return Response.json({ error: "ID warung tidak valid." }, { status: 400 });
  }

  const db = getDb();
  const res = db
    .prepare("UPDATE merchants SET is_active = 0 WHERE id = ?")
    .run(merchantId);

  if (res.changes === 0) {
    return Response.json({ error: "Warung tidak ditemukan." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
