import { z } from "zod";
import { hashPin } from "@/lib/auth-crypto";
import { withTransaction } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  division: z.string().trim().max(60).optional(),
  whatsapp: z.string().trim().max(20).optional(),
  role: z.enum(["EMPLOYEE", "OB", "ADMIN"]).optional(),
  pin: z.string().regex(/^\d{4,6}$/, "PIN harus 4-6 digit angka.").optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return Response.json({ error: "ID pengguna tidak valid." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Data tidak valid." },
        { status: 400 }
      );
    }

    const data = parsed.data;

    withTransaction((db) => {
      const target = db
        .prepare("SELECT id, name, division, whatsapp, role FROM users WHERE id = ?")
        .get(userId) as
        | { id: number; name: string; division: string; whatsapp: string; role: string }
        | undefined;

      if (!target) throw new Error("NOT_FOUND");

      // Prevent demoting the last remaining Super Admin
      if (target.role === "ADMIN" && data.role && data.role !== "ADMIN") {
        const admins = db
          .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'")
          .get() as { count: number };
        if (admins.count <= 1) {
          throw new Error("LAST_ADMIN");
        }
      }

      db.prepare(
        `UPDATE users
         SET name = ?, division = ?, whatsapp = ?, role = ?
         WHERE id = ?`
      ).run(
        data.name ?? target.name,
        data.division ?? target.division,
        data.whatsapp ?? target.whatsapp,
        data.role ?? target.role,
        userId
      );

      if (data.pin) {
        db.prepare("UPDATE users SET pin_hash = ? WHERE id = ?").run(
          hashPin(data.pin),
          userId
        );
      }
    });

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return Response.json({ error: "Pengguna tidak ditemukan." }, { status: 404 });
      }
      if (err.message === "LAST_ADMIN") {
        return Response.json(
          { error: "Minimal harus ada 1 akun Super Admin." },
          { status: 409 }
        );
      }
    }
    return Response.json({ error: "Gagal memperbarui pengguna." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return Response.json({ error: "ID pengguna tidak valid." }, { status: 400 });
  }

  if (userId === auth.user.id) {
    return Response.json(
      { error: "Tidak bisa menghapus akun yang sedang dipakai login." },
      { status: 409 }
    );
  }

  try {
    withTransaction((db) => {
      const target = db
        .prepare("SELECT id, role FROM users WHERE id = ?")
        .get(userId) as { id: number; role: string } | undefined;
      if (!target) throw new Error("NOT_FOUND");

      if (target.role === "ADMIN") {
        const admins = db
          .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'")
          .get() as { count: number };
        if (admins.count <= 1) throw new Error("LAST_ADMIN");
      }

      db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    });

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return Response.json({ error: "Pengguna tidak ditemukan." }, { status: 404 });
      }
      if (err.message === "LAST_ADMIN") {
        return Response.json(
          { error: "Minimal harus ada 1 akun Super Admin." },
          { status: 409 }
        );
      }
    }
    return Response.json({ error: "Gagal menghapus pengguna." }, { status: 500 });
  }
}
