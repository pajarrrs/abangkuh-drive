import { z } from "zod";
import { hashPin, verifyPin } from "@/lib/auth-crypto";
import { getDb, withTransaction } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import type { PhoneChangeRequest } from "@/lib/types";

const updateProfileSchema = z.object({
  whatsapp: z
    .string()
    .trim()
    .min(8, "Nomor telepon minimal 8 digit.")
    .max(20, "Nomor telepon maksimal 20 karakter.")
    .regex(/^[0-9+\-\s]+$/, "Nomor telepon hanya boleh angka, +, -, atau spasi.")
    .optional(),
  current_pin: z.string().regex(/^\d{4,6}$/, "PIN lama harus 4–6 digit angka.").optional(),
  new_pin: z.string().regex(/^\d{4,6}$/, "PIN baru harus 4–6 digit angka.").optional(),
});

export async function PATCH(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Data profil tidak valid." },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const db = getDb();
    let phoneRequestPending = false;

    if (data.new_pin !== undefined || data.current_pin !== undefined) {
      if (!data.current_pin || !data.new_pin) {
        return Response.json(
          { error: "Isi PIN lama dan PIN baru untuk mengganti PIN." },
          { status: 400 }
        );
      }

      const row = db
        .prepare("SELECT pin_hash FROM users WHERE id = ?")
        .get(auth.user.id) as { pin_hash: string } | undefined;

      if (!row || !verifyPin(data.current_pin, row.pin_hash)) {
        return Response.json(
          { error: "PIN lama tidak sesuai." },
          { status: 400 }
        );
      }

      db.prepare("UPDATE users SET pin_hash = ? WHERE id = ?").run(
        hashPin(data.new_pin),
        auth.user.id
      );
    }

    if (data.whatsapp !== undefined) {
      const normalizedNew = data.whatsapp.replace(/\s+/g, "");
      const normalizedOld = (auth.user.whatsapp || "").replace(/\s+/g, "");

      if (normalizedNew === normalizedOld) {
        return Response.json(
          { error: "Nomor telepon baru sama dengan nomor saat ini." },
          { status: 400 }
        );
      }

      if (auth.user.role === "ADMIN") {
        db.prepare("UPDATE users SET whatsapp = ? WHERE id = ?").run(
          normalizedNew,
          auth.user.id
        );
      } else {
        withTransaction((tx) => {
          tx.prepare(
            `DELETE FROM phone_change_requests
             WHERE user_id = ? AND status = 'PENDING'`
          ).run(auth.user.id);

          tx.prepare(
            `INSERT INTO phone_change_requests (user_id, old_whatsapp, new_whatsapp, status)
             VALUES (?, ?, ?, 'PENDING')`
          ).run(auth.user.id, auth.user.whatsapp || "", normalizedNew);
        });
        phoneRequestPending = true;
      }
    }

    const updatedUser = db
      .prepare(
        "SELECT id, name, username, division, whatsapp, role, created_at FROM users WHERE id = ?"
      )
      .get(auth.user.id) as Record<string, unknown>;

    const latestPhoneRequest = db
      .prepare(
        `SELECT id, user_id, old_whatsapp, new_whatsapp, status, reject_reason, created_at, reviewed_at
         FROM phone_change_requests
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(auth.user.id) as unknown as PhoneChangeRequest | undefined;

    return Response.json({
      user: {
        ...updatedUser,
        latest_phone_request: latestPhoneRequest ?? null,
      },
      phone_request_pending: phoneRequestPending,
    });
  } catch {
    return Response.json(
      { error: "Gagal menyimpan perubahan akun." },
      { status: 500 }
    );
  }
}
