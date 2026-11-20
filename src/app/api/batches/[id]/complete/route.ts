import { withTransaction } from "@/lib/db";
import { requireOB } from "@/lib/session";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOB();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const batchId = Number(id);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return Response.json({ error: "ID batch warung tidak valid." }, { status: 400 });
  }

  try {
    withTransaction((db) => {
      const res = db
        .prepare(
          `UPDATE merchant_batches
           SET status = 'COMPLETED',
               assigned_ob_id = COALESCE(assigned_ob_id, ?),
               updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(auth.user.id, batchId);

      if (res.changes === 0) {
        throw new Error("NOT_FOUND");
      }

      db.prepare(
        `UPDATE orders
         SET delivery_status = 'DELIVERED',
             updated_at = datetime('now')
         WHERE batch_id = ?
           AND payment_status != 'CANCELLED'
           AND delivery_status != 'UNAVAILABLE'`
      ).run(batchId);
    });

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return Response.json({ error: "Batch warung tidak ditemukan." }, { status: 404 });
    }
    return Response.json({ error: "Gagal menyelesaikan batch warung." }, { status: 500 });
  }
}
