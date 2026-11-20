import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { requireOB } from "@/lib/session";

const uploadPathRegex = /^\/api\/uploads\/[a-z0-9-]+\.(png|jpg|webp)$/;

const bulkPriceSchema = z.object({
  orders: z
    .array(
      z.object({
        order_id: z.number().int().positive(),
        actual_total: z.number().int().min(0).max(10000000),
        is_unavailable: z.boolean().optional().default(false),
      })
    )
    .min(1),
  qris_image_url: z.string().regex(uploadPathRegex).nullable().optional(),
  receipt_image_url: z.string().regex(uploadPathRegex).nullable().optional(),
  ob_note: z.string().trim().max(240).optional(),
  save_as_default: z.boolean().optional().default(false),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOB();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const batchId = Number(id);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return Response.json({ error: "ID warung tidak valid." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const parsed = bulkPriceSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Data harga tidak valid." },
        { status: 400 }
      );
    }

    const data = parsed.data;

    withTransaction((db) => {
      const batch = db
        .prepare(
          `SELECT id, merchant_id, merchant_name, assigned_ob_id, qris_image_url, receipt_image_url, ob_note
           FROM merchant_batches
           WHERE id = ?`
        )
        .get(batchId) as
        | {
            id: number;
            merchant_id: number | null;
            merchant_name: string;
            assigned_ob_id: number | null;
            qris_image_url: string | null;
            receipt_image_url: string | null;
            ob_note: string;
          }
        | undefined;

      if (!batch) throw new Error("NOT_FOUND");

      const merchantKey = batch.merchant_name.trim().toLowerCase();
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

      for (const entry of data.orders) {
        const order = db
          .prepare("SELECT id, payment_status FROM orders WHERE id = ? AND batch_id = ?")
          .get(entry.order_id, batchId) as
          | { id: number; payment_status: string }
          | undefined;
        if (!order || order.payment_status === "CANCELLED") continue;

        if (entry.is_unavailable) {
          db.prepare(
            `UPDATE order_items SET is_unavailable = 1 WHERE order_id = ?`
          ).run(entry.order_id);
          db.prepare(
            `UPDATE orders
             SET actual_total = 0,
                 payment_status = 'CANCELLED',
                 delivery_status = 'UNAVAILABLE',
                 updated_at = datetime('now')
             WHERE id = ?`
          ).run(entry.order_id);
          continue;
        }

        db.prepare(
          `UPDATE orders
           SET actual_total = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(entry.actual_total, entry.order_id);

        // If the order consists of 1 item line, sync exact unit price & update price memory
        const items = db
          .prepare(
            "SELECT id, menu_item_id, item_name, qty FROM order_items WHERE order_id = ? AND is_unavailable = 0"
          )
          .all(entry.order_id) as Array<{
          id: number;
          menu_item_id: number | null;
          item_name: string;
          qty: number;
        }>;

        if (items.length === 1 && items[0].qty > 0 && entry.actual_total > 0) {
          const single = items[0];
          const unitPrice = Math.round(entry.actual_total / single.qty);
          db.prepare(
            "UPDATE order_items SET actual_unit_price = ? WHERE id = ?"
          ).run(unitPrice, single.id);

          if (single.menu_item_id) {
            updateCatalogPrice.run(unitPrice, single.menu_item_id);
          }
          upsertMemory.run(
            merchantKey,
            single.item_name.trim().toLowerCase(),
            unitPrice
          );
        }
      }

      const finalQrisUrl =
        data.qris_image_url !== undefined ? data.qris_image_url : batch.qris_image_url;
      const finalReceiptUrl =
        data.receipt_image_url !== undefined
          ? data.receipt_image_url
          : batch.receipt_image_url;
      const finalNote = data.ob_note !== undefined ? data.ob_note : batch.ob_note;
      const assignedObId = batch.assigned_ob_id ?? auth.user.id;

      db.prepare(
        `UPDATE merchant_batches
         SET assigned_ob_id = ?,
             qris_image_url = ?,
             receipt_image_url = ?,
             ob_note = ?,
             status = CASE
               WHEN status = 'COMPLETED' THEN 'COMPLETED'
               WHEN ? IS NOT NULL THEN 'QRIS_UPLOADED'
               ELSE 'CLAIMED'
             END,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        assignedObId,
        finalQrisUrl,
        finalReceiptUrl,
        finalNote,
        finalQrisUrl,
        batchId
      );

      if (data.save_as_default && finalQrisUrl && batch.merchant_id) {
        db.prepare("UPDATE merchants SET default_qris_image = ? WHERE id = ?").run(
          finalQrisUrl,
          batch.merchant_id
        );
      }

      if (finalQrisUrl) {
        db.prepare(
          `UPDATE orders
           SET payment_status = 'WAITING_PAYMENT',
               updated_at = datetime('now')
           WHERE batch_id = ?
             AND payment_method = 'QRIS'
             AND payment_status = 'UNPAID'`
        ).run(batchId);
      }
    });

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return Response.json({ error: "Batch warung tidak ditemukan." }, { status: 404 });
    }
    return Response.json(
      { error: "Gagal menyimpan harga & tagihan warung." },
      { status: 500 }
    );
  }
}
