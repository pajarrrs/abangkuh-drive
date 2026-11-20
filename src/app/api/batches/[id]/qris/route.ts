import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { requireOB } from "@/lib/session";

const uploadPathRegex = /^\/api\/uploads\/[a-z0-9-]+\.(png|jpg|webp)$/;

const batchQrisSchema = z.object({
  qris_image_url: z.string().regex(uploadPathRegex, "URL gambar QRIS tidak valid.").nullable().optional(),
  use_default_qris: z.boolean().optional().default(false),
  receipt_image_url: z.string().regex(uploadPathRegex, "URL foto struk tidak valid.").nullable().optional(),
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
    return Response.json({ error: "ID batch warung tidak valid." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const parsed = batchQrisSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Data QRIS tidak valid." },
        { status: 400 }
      );
    }

    const data = parsed.data;

    withTransaction((db) => {
      const batch = db
        .prepare(
          `SELECT b.id, b.merchant_id, b.assigned_ob_id, b.qris_image_url, b.receipt_image_url, b.ob_note,
                  m.default_qris_image
           FROM merchant_batches b
           LEFT JOIN merchants m ON m.id = b.merchant_id
           WHERE b.id = ?`
        )
        .get(batchId) as
        | {
            id: number;
            merchant_id: number | null;
            assigned_ob_id: number | null;
            qris_image_url: string | null;
            receipt_image_url: string | null;
            ob_note: string;
            default_qris_image: string | null;
          }
        | undefined;

      if (!batch) {
        throw new Error("NOT_FOUND");
      }

      let finalQrisUrl = batch.qris_image_url;
      if (data.use_default_qris) {
        if (!batch.default_qris_image) {
          throw new Error("NO_DEFAULT_QRIS");
        }
        finalQrisUrl = batch.default_qris_image;
      } else if (data.qris_image_url) {
        finalQrisUrl = data.qris_image_url;
      }

      if (!finalQrisUrl) {
        throw new Error("QRIS_REQUIRED");
      }

      const finalReceiptUrl =
        data.receipt_image_url !== undefined ? data.receipt_image_url : batch.receipt_image_url;
      const finalNote = data.ob_note !== undefined ? data.ob_note : batch.ob_note;
      const assignedObId = batch.assigned_ob_id ?? auth.user.id;

      db.prepare(
        `UPDATE merchant_batches
         SET assigned_ob_id = ?,
             qris_image_url = ?,
             receipt_image_url = ?,
             ob_note = ?,
             status = CASE WHEN status = 'COMPLETED' THEN 'COMPLETED' ELSE 'QRIS_UPLOADED' END,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(assignedObId, finalQrisUrl, finalReceiptUrl, finalNote, batchId);

      // Save QRIS to merchant catalog if requested so OB doesn't have to re-photo next time
      if (data.save_as_default && batch.merchant_id) {
        db.prepare("UPDATE merchants SET default_qris_image = ? WHERE id = ?").run(
          finalQrisUrl,
          batch.merchant_id
        );
      }

      // Immediately notify/unlock payment ONLY for QRIS orders in this merchant batch
      db.prepare(
        `UPDATE orders
         SET payment_status = 'WAITING_PAYMENT',
             updated_at = datetime('now')
         WHERE batch_id = ?
           AND payment_method = 'QRIS'
           AND payment_status = 'UNPAID'`
      ).run(batchId);
    });

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return Response.json({ error: "Batch warung tidak ditemukan." }, { status: 404 });
      }
      if (err.message === "NO_DEFAULT_QRIS") {
        return Response.json({ error: "Warung ini belum punya QRIS tersimpan." }, { status: 400 });
      }
      if (err.message === "QRIS_REQUIRED") {
        return Response.json({ error: "Foto QRIS pedagang wajib diunggah." }, { status: 400 });
      }
    }
    return Response.json({ error: "Gagal menyimpan QRIS pedagang." }, { status: 500 });
  }
}
