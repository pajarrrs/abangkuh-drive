import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireOB } from "@/lib/session";

const updateSessionSchema = z.object({
  status: z.enum(["OPEN", "SHOPPING", "COMPLETED"]),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOB();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return Response.json({ error: "ID sesi tidak valid." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const parsed = updateSessionSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Status sesi tidak valid." }, { status: 400 });
    }

    const db = getDb();
    const res = db
      .prepare("UPDATE order_sessions SET status = ?, manual_override = 1 WHERE id = ?")
      .run(parsed.data.status, sessionId);

    if (res.changes === 0) {
      return Response.json({ error: "Sesi tidak ditemukan." }, { status: 404 });
    }

    const updated = db
      .prepare("SELECT * FROM order_sessions WHERE id = ?")
      .get(sessionId);

    return Response.json({ session: updated });
  } catch {
    return Response.json({ error: "Gagal mengubah status sesi." }, { status: 500 });
  }
}
