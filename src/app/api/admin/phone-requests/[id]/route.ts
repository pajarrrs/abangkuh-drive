import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

const reviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({
    action: z.literal("reject"),
    reason: z.string().trim().max(200).optional().default(""),
  }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const reqId = Number(id);
  if (!Number.isInteger(reqId) || reqId <= 0) {
    return Response.json({ error: "ID pengajuan tidak valid." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Permintaan tidak valid." },
        { status: 400 }
      );
    }

    withTransaction((db) => {
      const req = db
        .prepare(
          "SELECT id, user_id, new_whatsapp, status FROM phone_change_requests WHERE id = ?"
        )
        .get(reqId) as
        | { id: number; user_id: number; new_whatsapp: string; status: string }
        | undefined;

      if (!req) throw new Error("NOT_FOUND");
      if (req.status !== "PENDING") throw new Error("ALREADY_REVIEWED");

      if (parsed.data.action === "approve") {
        db.prepare("UPDATE users SET whatsapp = ? WHERE id = ?").run(
          req.new_whatsapp,
          req.user_id
        );
        db.prepare(
          `UPDATE phone_change_requests
           SET status = 'APPROVED',
               reject_reason = NULL,
               reviewed_by = ?,
               reviewed_at = datetime('now')
           WHERE id = ?`
        ).run(auth.user.id, reqId);
      } else {
        db.prepare(
          `UPDATE phone_change_requests
           SET status = 'REJECTED',
               reject_reason = ?,
               reviewed_by = ?,
               reviewed_at = datetime('now')
           WHERE id = ?`
        ).run(parsed.data.reason || "Ditolak oleh Admin.", auth.user.id, reqId);
      }
    });

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return Response.json({ error: "Pengajuan tidak ditemukan." }, { status: 404 });
      }
      if (err.message === "ALREADY_REVIEWED") {
        return Response.json(
          { error: "Pengajuan ini sudah diproses sebelumnya." },
          { status: 409 }
        );
      }
    }
    return Response.json({ error: "Gagal memproses pengajuan." }, { status: 500 });
  }
}
