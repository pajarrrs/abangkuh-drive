import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireOB } from "@/lib/session";

const claimSchema = z.object({
  release: z.boolean().optional().default(false),
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
    const body = await request.json().catch(() => ({}));
    const parsed = claimSchema.safeParse(body);
    const release = parsed.success ? parsed.data.release : false;

    const db = getDb();
    const batch = db
      .prepare("SELECT id, status, qris_image_url FROM merchant_batches WHERE id = ?")
      .get(batchId) as
      | { id: number; status: string; qris_image_url: string | null }
      | undefined;

    if (!batch) {
      return Response.json({ error: "Batch warung tidak ditemukan." }, { status: 404 });
    }

    if (release) {
      const nextStatus = batch.qris_image_url ? "QRIS_UPLOADED" : "COLLECTING";
      db.prepare(
        `UPDATE merchant_batches
         SET assigned_ob_id = NULL, status = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(nextStatus, batchId);
    } else {
      const nextStatus =
        batch.status === "COLLECTING" ? "CLAIMED" : batch.status;
      db.prepare(
        `UPDATE merchant_batches
         SET assigned_ob_id = ?, status = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(auth.user.id, nextStatus, batchId);
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Gagal mengubah penugasan Driver." }, { status: 500 });
  }
}
