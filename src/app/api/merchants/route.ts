import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { getMerchantsWithMenus } from "@/lib/queries";
import { requireAuth, requireOB } from "@/lib/session";

const createMerchantSchema = z.object({
  name: z.string().trim().min(2, "Nama warung minimal 2 karakter.").max(80),
  category: z.enum(["Makanan", "Minuman", "Minimarket", "Lainnya"]).default("Makanan"),
  location_note: z.string().trim().max(120).optional().default(""),
  menus: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        estimated_price: z.number().int().min(0).max(5000000),
      })
    )
    .optional()
    .default([]),
});

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  return Response.json({ merchants: getMerchantsWithMenus() });
}

export async function POST(request: Request) {
  const auth = await requireOB();
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = createMerchantSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Data warung tidak valid." },
        { status: 400 }
      );
    }

    const merchantId = withTransaction((db) => {
      const existing = db
        .prepare("SELECT id FROM merchants WHERE lower(name) = lower(?)")
        .get(parsed.data.name);
      if (existing) {
        throw new Error("DUPLICATE_MERCHANT");
      }

      const res = db
        .prepare(
          "INSERT INTO merchants (name, category, location_note) VALUES (?, ?, ?)"
        )
        .run(parsed.data.name, parsed.data.category, parsed.data.location_note);

      const newId = Number(res.lastInsertRowid);
      const insertMenu = db.prepare(
        "INSERT INTO menu_items (merchant_id, name, estimated_price) VALUES (?, ?, ?)"
      );
      for (const m of parsed.data.menus) {
        insertMenu.run(newId, m.name, m.estimated_price);
      }
      return newId;
    });

    return Response.json(
      { id: merchantId, merchants: getMerchantsWithMenus() },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "DUPLICATE_MERCHANT") {
      return Response.json({ error: "Nama warung sudah terdaftar." }, { status: 409 });
    }
    return Response.json({ error: "Gagal menambah warung." }, { status: 500 });
  }
}
