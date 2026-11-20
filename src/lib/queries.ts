import { getDb } from "./db";
import type { Merchant, MerchantBatch, MenuItem, OrderItem, OrderRecord } from "./types";

export function getMerchantsWithMenus(): Merchant[] {
  const db = getDb();
  const merchants = db
    .prepare(
      `SELECT id, name, category, location_note, default_qris_image, is_active
       FROM merchants
       WHERE is_active = 1
       ORDER BY name ASC`
    )
    .all() as unknown as Omit<Merchant, "menu_items">[];

  const menus = db
    .prepare(
      `SELECT id, merchant_id, name, estimated_price, is_active
       FROM menu_items
       WHERE is_active = 1
       ORDER BY id ASC`
    )
    .all() as unknown as MenuItem[];

  const byMerchant = new Map<number, MenuItem[]>();
  for (const m of menus) {
    const arr = byMerchant.get(m.merchant_id) ?? [];
    arr.push(m);
    byMerchant.set(m.merchant_id, arr);
  }

  return merchants.map((m) => ({
    ...m,
    menu_items: byMerchant.get(m.id) ?? [],
  }));
}

function attachItemsToOrders(rawOrders: Array<Omit<OrderRecord, "items" | "effective_total">>): OrderRecord[] {
  if (rawOrders.length === 0) return [];
  const db = getDb();
  const placeholders = rawOrders.map(() => "?").join(",");
  const ids = rawOrders.map((o) => o.id);

  const items = db
    .prepare(
      `SELECT id, order_id, menu_item_id, item_name, qty, unit_price, actual_unit_price, item_note, is_unavailable
       FROM order_items
       WHERE order_id IN (${placeholders})
       ORDER BY id ASC`
    )
    .all(...ids) as unknown as OrderItem[];

  const byOrder = new Map<number, OrderItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.order_id) ?? [];
    list.push(item);
    byOrder.set(item.order_id, list);
  }

  return rawOrders.map((o) => ({
    ...o,
    effective_total: o.actual_total !== null ? o.actual_total : o.estimated_total,
    items: byOrder.get(o.id) ?? [],
  }));
}

export function getUserOrders(userId: number, sessionId?: number): OrderRecord[] {
  const db = getDb();
  const params: Array<number | string> = [userId];
  let whereSession = "";
  if (sessionId) {
    whereSession = "AND o.session_id = ?";
    params.push(sessionId);
  }

  const rows = db
    .prepare(
      `
      SELECT
        o.*,
        u.name AS user_name,
        u.division AS user_division,
        u.whatsapp AS user_whatsapp,
        b.merchant_name AS merchant_name,
        b.status AS batch_status,
        b.qris_image_url AS batch_qris_image_url,
        b.receipt_image_url AS batch_receipt_image_url,
        b.ob_note AS batch_ob_note,
        b.assigned_ob_id AS assigned_ob_id,
        ob.name AS assigned_ob_name,
        s.label AS session_label,
        s.slot AS session_slot
      FROM orders o
      JOIN users u ON u.id = o.user_id
      JOIN merchant_batches b ON b.id = o.batch_id
      LEFT JOIN users ob ON ob.id = b.assigned_ob_id
      JOIN order_sessions s ON s.id = o.session_id
      WHERE o.user_id = ? ${whereSession}
      ORDER BY
        CASE o.payment_status
          WHEN 'WAITING_PAYMENT' THEN 1
          WHEN 'PROOF_UPLOADED' THEN 2
          WHEN 'UNPAID' THEN 3
          WHEN 'PAID' THEN 4
          ELSE 5
        END,
        o.created_at DESC
      `
    )
    .all(...params) as unknown as Array<Omit<OrderRecord, "items" | "effective_total">>;

  return attachItemsToOrders(rows);
}

export function getSessionBatchesForOB(sessionId: number): MerchantBatch[] {
  const db = getDb();
  const batches = db
    .prepare(
      `
      SELECT
        b.id,
        b.session_id,
        b.merchant_id,
        b.merchant_name,
        m.default_qris_image AS merchant_default_qris,
        b.assigned_ob_id,
        ob.name AS assigned_ob_name,
        b.qris_image_url,
        b.receipt_image_url,
        b.ob_note,
        b.status,
        b.updated_at
      FROM merchant_batches b
      LEFT JOIN merchants m ON m.id = b.merchant_id
      LEFT JOIN users ob ON ob.id = b.assigned_ob_id
      WHERE b.session_id = ?
      ORDER BY
        CASE b.status
          WHEN 'QRIS_UPLOADED' THEN 1
          WHEN 'CLAIMED' THEN 2
          WHEN 'COLLECTING' THEN 3
          ELSE 4
        END,
        b.merchant_name ASC
      `
    )
    .all(sessionId) as unknown as Array<Omit<MerchantBatch, "orders" | "summary">>;

  if (batches.length === 0) return [];

  const orderRows = db
    .prepare(
      `
      SELECT
        o.*,
        u.name AS user_name,
        u.division AS user_division,
        u.whatsapp AS user_whatsapp,
        b.merchant_name AS merchant_name,
        b.status AS batch_status,
        b.qris_image_url AS batch_qris_image_url,
        b.receipt_image_url AS batch_receipt_image_url,
        b.ob_note AS batch_ob_note,
        b.assigned_ob_id AS assigned_ob_id,
        ob.name AS assigned_ob_name,
        s.label AS session_label,
        s.slot AS session_slot
      FROM orders o
      JOIN users u ON u.id = o.user_id
      JOIN merchant_batches b ON b.id = o.batch_id
      LEFT JOIN users ob ON ob.id = b.assigned_ob_id
      JOIN order_sessions s ON s.id = o.session_id
      WHERE o.session_id = ?
      ORDER BY o.created_at ASC
      `
    )
    .all(sessionId) as unknown as Array<Omit<OrderRecord, "items" | "effective_total">>;

  const hydratedOrders = attachItemsToOrders(orderRows);
  const byBatch = new Map<number, OrderRecord[]>();
  for (const order of hydratedOrders) {
    const list = byBatch.get(order.batch_id) ?? [];
    list.push(order);
    byBatch.set(order.batch_id, list);
  }

  return batches.map((b) => {
    const orders = byBatch.get(b.id) ?? [];
    const activeOrders = orders.filter((o) => o.payment_status !== "CANCELLED");

    let qrisTotal = 0;
    let qrisPaid = 0;
    let cashTotal = 0;
    let cashPaid = 0;
    let pendingVerificationCount = 0;
    let unpaidCount = 0;

    for (const o of activeOrders) {
      const amt = o.effective_total;
      if (o.payment_method === "QRIS") {
        qrisTotal += amt;
        if (o.payment_status === "PAID") qrisPaid += amt;
      } else {
        cashTotal += amt;
        if (o.payment_status === "PAID") cashPaid += amt;
      }
      if (o.payment_status === "PROOF_UPLOADED") pendingVerificationCount += 1;
      if (o.payment_status !== "PAID") unpaidCount += 1;
    }

    return {
      ...b,
      orders,
      summary: {
        order_count: activeOrders.length,
        qris_total: qrisTotal,
        qris_paid: qrisPaid,
        cash_total: cashTotal,
        cash_paid: cashPaid,
        grand_total: qrisTotal + cashTotal,
        pending_verification_count: pendingVerificationCount,
        unpaid_count: unpaidCount,
      },
    };
  });
}
