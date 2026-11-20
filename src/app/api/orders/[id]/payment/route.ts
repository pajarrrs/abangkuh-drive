import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { requireAuth } from "@/lib/session";

const paymentActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submit_proof"),
    payment_proof_url: z.string().regex(/^\/api\/uploads\/[a-z0-9-]+\.(png|jpg|webp)$/, "URL bukti bayar tidak valid."),
  }),
  z.object({
    action: z.literal("switch_method"),
    payment_method: z.enum(["QRIS", "CASH"]),
  }),
  z.object({
    action: z.literal("update_prices"),
    items: z
      .array(
        z.object({
          id: z.number().int().positive(),
          actual_unit_price: z.number().int().min(0).max(5000000),
          is_unavailable: z.boolean().optional().default(false),
        })
      )
      .min(1),
  }),
  z.object({
    action: z.literal("confirm_paid"),
  }),
  z.object({
    action: z.literal("reject_proof"),
    reason: z.string().trim().min(2, "Alasan penolakan wajib diisi.").max(200),
  }),
  z.object({
    action: z.literal("update_delivery"),
    delivery_status: z.enum(["PENDING", "BOUGHT", "DELIVERED", "UNAVAILABLE"]),
  }),
]);

export async function PATCH(
  request: Request,
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
    const body = await request.json();
    const parsed = paymentActionSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Permintaan tidak valid." },
        { status: 400 }
      );
    }

    const payload = parsed.data;

    withTransaction((db) => {
      const order = db
        .prepare(
          `SELECT o.*, b.qris_image_url AS batch_qris
           FROM orders o
           JOIN merchant_batches b ON b.id = o.batch_id
           WHERE o.id = ?`
        )
        .get(orderId) as
        | {
            id: number;
            user_id: number;
            payment_method: "QRIS" | "CASH";
            payment_status: string;
            batch_qris: string | null;
          }
        | undefined;

      if (!order) {
        throw new Error("NOT_FOUND");
      }

      const isPrivileged = auth.user.role === "OB" || auth.user.role === "ADMIN";

      if (payload.action === "submit_proof") {
        if (order.user_id !== auth.user.id && !isPrivileged) {
          throw new Error("FORBIDDEN");
        }
        if (order.payment_status === "PAID" || order.payment_status === "CANCELLED") {
          throw new Error("INVALID_STATE");
        }
        db.prepare(
          `UPDATE orders
           SET payment_method = 'QRIS',
               payment_proof_url = ?,
               payment_status = 'PROOF_UPLOADED',
               payment_reject_reason = NULL,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(payload.payment_proof_url, orderId);
        return;
      }

      if (payload.action === "switch_method") {
        if (order.user_id !== auth.user.id && !isPrivileged) {
          throw new Error("FORBIDDEN");
        }
        if (order.payment_status === "PAID" || order.payment_status === "CANCELLED") {
          throw new Error("INVALID_STATE");
        }
        const nextStatus =
          payload.payment_method === "QRIS" && order.batch_qris
            ? "WAITING_PAYMENT"
            : "UNPAID";
        db.prepare(
          `UPDATE orders
           SET payment_method = ?,
               payment_status = ?,
               payment_reject_reason = NULL,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(payload.payment_method, nextStatus, orderId);
        return;
      }

      // All remaining actions are strictly OB / Super Admin only
      if (!isPrivileged) {
        throw new Error("FORBIDDEN_OB");
      }

      if (payload.action === "update_prices") {
        const batchRow = db
          .prepare(
            `SELECT b.merchant_name
             FROM orders o
             JOIN merchant_batches b ON b.id = o.batch_id
             WHERE o.id = ?`
          )
          .get(orderId) as { merchant_name: string } | undefined;
        const merchantKey = (batchRow?.merchant_name || "").trim().toLowerCase();

        const updateItem = db.prepare(
          `UPDATE order_items
           SET actual_unit_price = ?, is_unavailable = ?
           WHERE id = ? AND order_id = ?`
        );
        for (const item of payload.items) {
          updateItem.run(
            item.actual_unit_price,
            item.is_unavailable ? 1 : 0,
            item.id,
            orderId
          );
        }

        const latestItems = db
          .prepare(
            "SELECT menu_item_id, item_name, qty, unit_price, actual_unit_price, is_unavailable FROM order_items WHERE order_id = ?"
          )
          .all(orderId) as Array<{
          menu_item_id: number | null;
          item_name: string;
          qty: number;
          unit_price: number;
          actual_unit_price: number | null;
          is_unavailable: number;
        }>;

        const updateCatalogPrice = db.prepare(
          "UPDATE menu_items SET estimated_price = ? WHERE id = ?"
        );
        const upsertMemory = db.prepare(
          `INSERT INTO item_price_memory (merchant_key, item_key, last_price, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(merchant_key, item_key) DO UPDATE SET
             last_price = excluded.last_price,
             updated_at = datetime('now')`
        );

        let actualTotal = 0;
        let availableCount = 0;
        for (const it of latestItems) {
          if (it.is_unavailable === 1) continue;
          availableCount += 1;
          const unit = it.actual_unit_price !== null ? it.actual_unit_price : it.unit_price;
          actualTotal += it.qty * unit;

          if (it.actual_unit_price !== null && it.actual_unit_price > 0) {
            if (it.menu_item_id) {
              updateCatalogPrice.run(it.actual_unit_price, it.menu_item_id);
            }
            if (merchantKey) {
              upsertMemory.run(
                merchantKey,
                it.item_name.trim().toLowerCase(),
                it.actual_unit_price
              );
            }
          }
        }

        if (availableCount === 0) {
          db.prepare(
            `UPDATE orders
             SET actual_total = 0,
                 payment_status = 'CANCELLED',
                 delivery_status = 'UNAVAILABLE',
                 updated_at = datetime('now')
             WHERE id = ?`
          ).run(orderId);
        } else {
          db.prepare(
            `UPDATE orders
             SET actual_total = ?,
                 updated_at = datetime('now')
             WHERE id = ?`
          ).run(actualTotal, orderId);
        }
        return;
      }

      if (payload.action === "confirm_paid") {
        db.prepare(
          `UPDATE orders
           SET payment_status = 'PAID',
               payment_reject_reason = NULL,
               delivery_status = CASE WHEN delivery_status = 'PENDING' THEN 'BOUGHT' ELSE delivery_status END,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(orderId);
        return;
      }

      if (payload.action === "reject_proof") {
        db.prepare(
          `UPDATE orders
           SET payment_status = 'WAITING_PAYMENT',
               payment_reject_reason = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(payload.reason, orderId);
        return;
      }

      if (payload.action === "update_delivery") {
        db.prepare(
          `UPDATE orders
           SET delivery_status = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(payload.delivery_status, orderId);
      }
    });

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return Response.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
      }
      if (err.message === "FORBIDDEN" || err.message === "FORBIDDEN_OB") {
        return Response.json({ error: "Anda tidak memiliki izin untuk aksi ini." }, { status: 403 });
      }
      if (err.message === "INVALID_STATE") {
        return Response.json({ error: "Status pesanan tidak memungkinkan perubahan ini." }, { status: 409 });
      }
    }
    return Response.json({ error: "Gagal memperbarui pesanan." }, { status: 500 });
  }
}
