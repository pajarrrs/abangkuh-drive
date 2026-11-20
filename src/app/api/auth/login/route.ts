import { z } from "zod";
import { verifyPin } from "@/lib/auth-crypto";
import { getDb } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";

const loginSchema = z.object({
  username: z.string().trim().min(2).max(40),
  pin: z.string().regex(/^\d{4,6}$/, "PIN harus 4-6 digit angka."),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Input tidak valid." },
        { status: 400 }
      );
    }

    const db = getDb();
    const user = db
      .prepare(
        "SELECT id, name, username, division, whatsapp, role, pin_hash FROM users WHERE lower(username) = lower(?)"
      )
      .get(parsed.data.username) as
      | {
          id: number;
          name: string;
          username: string;
          division: string;
          whatsapp: string;
          role: "EMPLOYEE" | "OB" | "ADMIN";
          pin_hash: string;
        }
      | undefined;

    if (!user || !verifyPin(parsed.data.pin, user.pin_hash)) {
      return Response.json(
        { error: "Username atau PIN salah." },
        { status: 401 }
      );
    }

    await setSessionCookie(user.id, user.role);

    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        division: user.division,
        whatsapp: user.whatsapp,
        role: user.role,
      },
    });
  } catch {
    return Response.json(
      { error: "Terjadi kesalahan saat login." },
      { status: 500 }
    );
  }
}
