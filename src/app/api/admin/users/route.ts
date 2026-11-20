import { z } from "zod";
import { hashPin } from "@/lib/auth-crypto";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

const createUserSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(60),
  username: z
    .string()
    .trim()
    .min(2, "Username minimal 2 karakter.")
    .max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "Username hanya boleh huruf, angka, titik, atau underscore."),
  division: z.string().trim().max(60).optional().default(""),
  whatsapp: z.string().trim().max(20).optional().default(""),
  role: z.enum(["EMPLOYEE", "OB", "ADMIN"]),
  pin: z.string().regex(/^\d{4,6}$/, "PIN harus 4-6 digit angka."),
});

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const db = getDb();
  const users = db
    .prepare(
      `
      SELECT
        u.id,
        u.name,
        u.username,
        u.division,
        u.whatsapp,
        u.role,
        u.created_at,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
      FROM users u
      ORDER BY CASE u.role WHEN 'ADMIN' THEN 1 WHEN 'OB' THEN 2 ELSE 3 END, u.name ASC
      `
    )
    .all();

  return Response.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Data akun tidak valid." },
        { status: 400 }
      );
    }

    const db = getDb();
    const usernameLower = parsed.data.username.toLowerCase();
    const existing = db
      .prepare("SELECT id FROM users WHERE lower(username) = ?")
      .get(usernameLower);
    if (existing) {
      return Response.json({ error: "Username sudah digunakan." }, { status: 409 });
    }

    const res = db
      .prepare(
        "INSERT INTO users (name, username, division, whatsapp, role, pin_hash) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        parsed.data.name,
        usernameLower,
        parsed.data.division,
        parsed.data.whatsapp,
        parsed.data.role,
        hashPin(parsed.data.pin)
      );

    return Response.json({ id: Number(res.lastInsertRowid) }, { status: 201 });
  } catch {
    return Response.json({ error: "Gagal membuat akun." }, { status: 500 });
  }
}
