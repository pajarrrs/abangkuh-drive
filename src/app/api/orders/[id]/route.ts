import { withTransaction } from "@/lib/db";
import { requireAuth } from "@/lib/session";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return Response.json({ error: "ID pesanan tidak valid." }, { status: 400 });
  }

  try {
    withTransaction((db) => {
      const order = db
        .prepare(
          `SELECT o.id, o.user_id, o.batch_id, o.payment_status, b.status AS batch_status
           FROM orders o
           JOIN merchant_batches b ON b.id = o.batch_id
           WHERE o.id = ?`
        )
        .get(orderId) as
        | {
            id: number;
            user_id: number;
            batch_id: number;
            payment_status: string;
            batch_status: string;
          }
        | undefined;

      if (!order) {
        throw new Error("NOT_FOUND");
      }

      const isOwner = order.user_id === auth.user.id;
      const isOB = auth.user.role === "OB" || auth.user.role === "ADMIN";

      if (!isOwner && !isOB) {
        throw new Error("FORBIDDEN");
      }

      if (!isOB) {
        if (order.payment_status === "PAID" || order.payment_status === "PROOF_UPLOADED") {
          throw new Error("ALREADY_PAID");
        }
        if (order.batch_status !== "COLLECTING") {
          throw new Error("BATCH_IN_PROGRESS");
        }
      }

      db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);

      // Remove empty merchant batch automatically so OB board stays clean
      const remaining = db
        .prepare("SELECT COUNT(*) AS count FROM orders WHERE batch_id = ?")
        .get(order.batch_id) as { count: number };
      if (remaining.count === 0) {
        db.prepare("DELETE FROM merchant_batches WHERE id = ?").run(order.batch_id);
      }
    });

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return Response.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
      }
      if (err.message === "FORBIDDEN") {
        return Response.json({ error: "Tidak punya akses membatalkan pesanan ini." }, { status: 403 });
      }
      if (err.message === "ALREADY_PAID") {
        return Response.json({ error: "Pesanan yang sudah dibayar tidak dapat dibatalkan sendiri." }, { status: 409 });
      }
      if (err.message === "BATCH_IN_PROGRESS") {
        return Response.json(
          { error: "Driver sudah mengklaim/memproses warung ini. Hubungi Driver untuk pembatalan." },
          { status: 409 }
        );
      }
    }
    return Response.json({ error: "Gagal membatalkan pesanan." }, { status: 500 });
  }
}
