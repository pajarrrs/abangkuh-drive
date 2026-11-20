import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireOB } from "@/lib/session";

const createMenuSchema = z.object({
  name: z.string().trim().min(1, "Nama menu wajib diisi.").max(80),
  estimated_price: z.number().int().min(0).max(5000000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOB();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const merchantId = Number(id);
  if (!Number.isInteger(merchantId) || merchantId <= 0) {
    return Response.json({ error: "ID warung tidak valid." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const parsed = createMenuSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Data menu tidak valid." },
        { status: 400 }
      );
    }

    const db = getDb();
    const merchant = db
      .prepare("SELECT id FROM merchants WHERE id = ?")
      .get(merchantId);
    if (!merchant) {
      return Response.json({ error: "Warung tidak ditemukan." }, { status: 404 });
    }

    const res = db
      .prepare(
        "INSERT INTO menu_items (merchant_id, name, estimated_price) VALUES (?, ?, ?)"
      )
      .run(merchantId, parsed.data.name, parsed.data.estimated_price);

    return Response.json(
      {
        menu_item: {
          id: Number(res.lastInsertRowid),
          merchant_id: merchantId,
          name: parsed.data.name,
          estimated_price: parsed.data.estimated_price,
          is_active: 1,
        },
      },
      { status: 201 }
    );
  } catch {
    return Response.json({ error: "Gagal menambah menu." }, { status: 500 });
  }
}
