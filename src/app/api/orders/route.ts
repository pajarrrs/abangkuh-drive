import { z } from "zod";
import { getDb, withTransaction } from "@/lib/db";
import { getSessionBatchesForOB, getUserOrders } from "@/lib/queries";
import { requireAuth } from "@/lib/session";

const createOrderSchema = z.object({
  session_id: z.number().int().positive(),
  merchant_id: z.number().int().positive().nullable().optional(),
  merchant_name: z.string().trim().min(2, "Nama warung/toko wajib diisi.").max(80),
  payment_method: z.enum(["QRIS", "CASH"]),
  max_budget: z.number().int().min(0).max(5000000).nullable().optional(),
  notes: z.string().trim().max(240).optional().default(""),
  items: z
    .array(
      z.object({
        menu_item_id: z.number().int().positive().nullable().optional(),
        item_name: z.string().trim().min(1, "Nama item wajib diisi.").max(100),
        qty: z.number().int().min(1).max(99),
        unit_price: z.number().int().min(0).max(5000000),
        item_note: z.string().trim().max(120).optional().default(""),
      })
    )
    .min(1, "Minimal pesan 1 item."),
});

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "mine";
  const sessionIdParam = searchParams.get("sessionId");
  const sessionId = sessionIdParam ? Number(sessionIdParam) : undefined;

  if (sessionIdParam && (!Number.isInteger(sessionId) || (sessionId ?? 0) <= 0)) {
    return Response.json({ error: "Parameter sessionId tidak valid." }, { status: 400 });
  }

  if (scope === "batches") {
    if (auth.user.role !== "OB" && auth.user.role !== "ADMIN") {
      return Response.json({ error: "Akses khusus Driver / Super Admin." }, { status: 403 });
    }
    if (!sessionId) {
      return Response.json({ error: "sessionId wajib diisi untuk melihat batch." }, { status: 400 });
    }
    const batches = getSessionBatchesForOB(sessionId);
    return Response.json({ batches });
  }

  const orders = getUserOrders(auth.user.id, sessionId);
  return Response.json({ orders });
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Data pesanan tidak valid." },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const normalizedMerchantName = data.merchant_name.replace(/\s+/g, " ").trim();

    const orderId = withTransaction((db) => {
      const session = db
        .prepare("SELECT id, status FROM order_sessions WHERE id = ?")
        .get(data.session_id) as { id: number; status: string } | undefined;

      if (!session) {
        throw new Error("SESSION_NOT_FOUND");
      }
      if (session.status !== "OPEN") {
        throw new Error("SESSION_CLOSED");
      }

      let resolvedMerchantId: number | null = data.merchant_id ?? null;
      let resolvedMerchantName = normalizedMerchantName;

      if (resolvedMerchantId) {
        const merchant = db
          .prepare("SELECT id, name FROM merchants WHERE id = ?")
          .get(resolvedMerchantId) as { id: number; name: string } | undefined;
        if (merchant) {
          resolvedMerchantName = merchant.name;
        } else {
          resolvedMerchantId = null;
        }
      } else {
        const matchedMerchant = db
          .prepare("SELECT id, name FROM merchants WHERE lower(trim(name)) = lower(?)")
          .get(normalizedMerchantName) as { id: number; name: string } | undefined;
        if (matchedMerchant) {
          resolvedMerchantId = matchedMerchant.id;
          resolvedMerchantName = matchedMerchant.name;
        }
      }

      const existingBatch = db
        .prepare(
          `SELECT id, qris_image_url, status
           FROM merchant_batches
           WHERE session_id = ? AND lower(trim(merchant_name)) = lower(?)`
        )
        .get(data.session_id, resolvedMerchantName) as
        | { id: number; qris_image_url: string | null; status: string }
        | undefined;

      let batchId: number;
      let batchHasQris = false;

      if (existingBatch) {
        batchId = existingBatch.id;
        batchHasQris = Boolean(existingBatch.qris_image_url);
      } else {
        const batchRes = db
          .prepare(
            `INSERT INTO merchant_batches (session_id, merchant_id, merchant_name, status)
             VALUES (?, ?, ?, 'COLLECTING')`
          )
          .run(data.session_id, resolvedMerchantId, resolvedMerchantName);
        batchId = Number(batchRes.lastInsertRowid);
      }

      // Auto-fill remembered prices for unknown-price items from price memory
      const merchantKey = resolvedMerchantName.toLowerCase();
      const lookupMemory = db.prepare(
        "SELECT last_price FROM item_price_memory WHERE merchant_key = ? AND item_key = ?"
      );
      const resolvedItems = data.items.map((item) => {
        if (item.unit_price > 0) return item;
        const mem = lookupMemory.get(
          merchantKey,
          item.item_name.trim().toLowerCase()
        ) as { last_price: number } | undefined;
        return mem && mem.last_price > 0
          ? { ...item, unit_price: mem.last_price }
          : item;
      });

      // Integer IDR reconciliation: header total strictly equals sum of line items
      const estimatedTotal = resolvedItems.reduce(
        (sum, item) => sum + item.qty * item.unit_price,
        0
      );

      const initialPaymentStatus =
        data.payment_method === "QRIS" && batchHasQris ? "WAITING_PAYMENT" : "UNPAID";

      const orderRes = db
        .prepare(
          `INSERT INTO orders (
             session_id, batch_id, user_id, payment_method, estimated_total, max_budget, payment_status, notes
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          data.session_id,
          batchId,
          auth.user.id,
          data.payment_method,
          estimatedTotal,
          data.max_budget && data.max_budget > 0 ? data.max_budget : null,
          initialPaymentStatus,
          data.notes
        );

      const newOrderId = Number(orderRes.lastInsertRowid);
      const insertItem = db.prepare(
        `INSERT INTO order_items (order_id, menu_item_id, item_name, qty, unit_price, item_note)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      for (const item of resolvedItems) {
        insertItem.run(
          newOrderId,
          item.menu_item_id ?? null,
          item.item_name,
          item.qty,
          item.unit_price,
          item.item_note
        );
      }

      return newOrderId;
    });

    const db = getDb();
    const created = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    return Response.json({ order: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "SESSION_NOT_FOUND") {
      return Response.json({ error: "Sesi tidak ditemukan." }, { status: 404 });
    }
    if (err instanceof Error && err.message === "SESSION_CLOSED") {
      return Response.json(
        { error: "Sesi sudah ditutup karena Driver sedang belanja atau sudah selesai." },
        { status: 409 }
      );
    }
    return Response.json({ error: "Gagal menyimpan pesanan." }, { status: 500 });
  }
}
