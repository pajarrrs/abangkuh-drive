import { z } from "zod";
import { hashPin } from "@/lib/auth-crypto";
import { getDb } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";

const registerSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(60),
  username: z
    .string()
    .trim()
    .min(2, "Username minimal 2 karakter.")
    .max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "Username hanya boleh huruf, angka, titik, atau underscore."),
  division: z.string().trim().max(60).optional().default(""),
  whatsapp: z.string().trim().max(20).optional().default(""),
  pin: z.string().regex(/^\d{4,6}$/, "PIN harus 4-6 digit angka."),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Data pendaftaran tidak valid." },
        { status: 400 }
      );
    }

    const db = getDb();
    const usernameLower = parsed.data.username.toLowerCase();
    const existing = db
      .prepare("SELECT id FROM users WHERE lower(username) = ?")
      .get(usernameLower);

    if (existing) {
      return Response.json(
        { error: "Username sudah dipakai rekan kantor lain. Coba username lain." },
        { status: 409 }
      );
    }

    const pinHash = hashPin(parsed.data.pin);
    const res = db
      .prepare(
        "INSERT INTO users (name, username, division, whatsapp, role, pin_hash) VALUES (?, ?, ?, ?, 'EMPLOYEE', ?)"
      )
      .run(
        parsed.data.name,
        usernameLower,
        parsed.data.division,
        parsed.data.whatsapp,
        pinHash
      );

    const newId = Number(res.lastInsertRowid);
    await setSessionCookie(newId, "EMPLOYEE");

    return Response.json(
      {
        user: {
          id: newId,
          name: parsed.data.name,
          username: usernameLower,
          division: parsed.data.division,
          whatsapp: parsed.data.whatsapp,
          role: "EMPLOYEE" as const,
        },
      },
      { status: 201 }
    );
  } catch {
    return Response.json(
      { error: "Gagal mendaftar akun baru." },
      { status: 500 }
    );
  }
}
