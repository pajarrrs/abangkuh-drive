import { z } from "zod";
import { getDb } from "@/lib/db";
import { getJakartaNow } from "@/lib/format";
import { requireAuth } from "@/lib/session";
import type { ObLocationInfo, ObLocationStatus } from "@/lib/types";

const startSharingSchema = z.object({
  is_sharing: z.literal(true),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000),
  current_merchant_name: z.string().trim().max(80).optional().default(""),
  status_label: z
    .enum(["ON_THE_WAY", "AT_MERCHANT", "RETURNING"])
    .default("ON_THE_WAY"),
});

const stopSharingSchema = z.object({
  is_sharing: z.literal(false),
});

const updateLocationSchema = z.discriminatedUnion("is_sharing", [
  startSharingSchema,
  stopSharingSchema,
]);

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const db = getDb();
  const { date } = getJakartaNow();

  const obRows = db
    .prepare(
      `
      SELECT
        u.id AS ob_id,
        u.name AS ob_name,
        u.username AS ob_username,
        l.lat,
        l.lng,
        l.accuracy,
        COALESCE(l.current_merchant_name, '') AS current_merchant_name,
        COALESCE(l.status_label, 'OFFLINE') AS status_label,
        COALESCE(l.is_sharing, 0) AS is_sharing,
        l.updated_at
      FROM users u
      LEFT JOIN ob_locations l ON l.ob_id = u.id
      WHERE u.role = 'OB'
      ORDER BY u.id ASC
      `
    )
    .all() as Array<{
    ob_id: number;
    ob_name: string;
    ob_username: string;
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    current_merchant_name: string;
    status_label: ObLocationStatus;
    is_sharing: number;
    updated_at: string | null;
  }>;

  const batchRows = db
    .prepare(
      `
      SELECT b.assigned_ob_id AS ob_id, b.merchant_name
      FROM merchant_batches b
      JOIN order_sessions s ON s.id = b.session_id
      WHERE s.session_date = ?
        AND b.assigned_ob_id IS NOT NULL
        AND b.status != 'COMPLETED'
      ORDER BY b.updated_at DESC
      `
    )
    .all(date) as Array<{ ob_id: number; merchant_name: string }>;

  const merchantsByOb = new Map<number, string[]>();
  for (const row of batchRows) {
    const arr = merchantsByOb.get(row.ob_id) ?? [];
    if (!arr.includes(row.merchant_name)) arr.push(row.merchant_name);
    merchantsByOb.set(row.ob_id, arr);
  }

  const locations: ObLocationInfo[] = obRows.map((row) => ({
    ...row,
    active_merchants: merchantsByOb.get(row.ob_id) ?? [],
  }));

  return Response.json({ locations });
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  if (auth.user.role !== "OB") {
    return Response.json(
      { error: "Hanya perangkat Driver yang dapat membagikan lokasi GPS." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = updateLocationSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Data lokasi GPS tidak valid." },
        { status: 400 }
      );
    }

    const db = getDb();

    if (!parsed.data.is_sharing) {
      db.prepare(
        `UPDATE ob_locations
         SET is_sharing = 0, status_label = 'OFFLINE', current_merchant_name = '', updated_at = datetime('now')
         WHERE ob_id = ?`
      ).run(auth.user.id);
      return Response.json({ ok: true });
    }

    const data = parsed.data;
    db.prepare(
      `
      INSERT INTO ob_locations (
        ob_id, lat, lng, accuracy, current_merchant_name, status_label, is_sharing, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(ob_id) DO UPDATE SET
        lat = excluded.lat,
        lng = excluded.lng,
        accuracy = excluded.accuracy,
        current_merchant_name = excluded.current_merchant_name,
        status_label = excluded.status_label,
        is_sharing = 1,
        updated_at = datetime('now')
      `
    ).run(
      auth.user.id,
      data.lat,
      data.lng,
      data.accuracy,
      data.current_merchant_name,
      data.status_label
    );

    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Gagal memperbarui lokasi GPS." },
      { status: 500 }
    );
  }
}
