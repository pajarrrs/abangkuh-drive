import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const updateScheduleSchema = z.object({
  open_time: z.string().regex(hhmmRegex, "Format jam buka harus HH:MM."),
  close_time: z.string().regex(hhmmRegex, "Format jam tutup harus HH:MM."),
  status: z.enum(["OPEN", "SHOPPING", "COMPLETED"]).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return Response.json({ error: "ID sesi tidak valid." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const parsed = updateScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Jadwal sesi tidak valid." },
        { status: 400 }
      );
    }

    const db = getDb();
    const existing = db
      .prepare("SELECT id, slot, status FROM order_sessions WHERE id = ?")
      .get(sessionId) as { id: number; slot: string; status: string } | undefined;

    if (!existing) {
      return Response.json({ error: "Sesi tidak ditemukan." }, { status: 404 });
    }

    const slotName = existing.slot === "SIANG" ? "Sesi Siang" : "Sesi Sore";
    const newLabel = `${slotName} (${parsed.data.open_time} - ${parsed.data.close_time})`;

    db.prepare(
      `UPDATE order_sessions
       SET open_time = ?, close_time = ?, label = ?, status = ?, manual_override = 1
       WHERE id = ?`
    ).run(
      parsed.data.open_time,
      parsed.data.close_time,
      newLabel,
      parsed.data.status ?? existing.status,
      sessionId
    );

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Gagal mengubah jadwal sesi." }, { status: 500 });
  }
}
