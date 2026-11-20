"use client";

import { useMemo } from "react";
import { formatRupiah } from "@/lib/format";
import type { MerchantBatch, OrderRecord, OrderSession } from "@/lib/types";

interface OBRecapTabProps {
  selectedSession: OrderSession | null;
  batches: MerchantBatch[];
}

function toWaUrl(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9) return null;
  const normalized = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

export function OBRecapTab({ selectedSession, batches }: OBRecapTabProps) {
  const recap = useMemo(() => {
    let qrisTotal = 0;
    let qrisPaid = 0;
    let cashTotal = 0;
    let cashPaid = 0;
    const unpaidOrders: OrderRecord[] = [];
    const byOb = new Map<
      string,
      { name: string; batchCount: number; orderCount: number; total: number }
    >();

    for (const b of batches) {
      qrisTotal += b.summary.qris_total;
      qrisPaid += b.summary.qris_paid;
      cashTotal += b.summary.cash_total;
      cashPaid += b.summary.cash_paid;

      const obKey = b.assigned_ob_name || "Belum Diambil";
      const prev = byOb.get(obKey) ?? {
        name: obKey,
        batchCount: 0,
        orderCount: 0,
        total: 0,
      };
      prev.batchCount += 1;
      prev.orderCount += b.summary.order_count;
      prev.total += b.summary.grand_total;
      byOb.set(obKey, prev);

      for (const o of b.orders) {
        if (o.payment_status !== "PAID" && o.payment_status !== "CANCELLED") {
          unpaidOrders.push(o);
        }
      }
    }

    return {
      qrisTotal,
      qrisPaid,
      cashTotal,
      cashPaid,
      grandTotal: qrisTotal + cashTotal,
      grandPaid: qrisPaid + cashPaid,
      unpaidOrders,
      byOb: Array.from(byOb.values()),
    };
  }, [batches]);

  return (
    <div className="bg-white pb-8">
      {/* Alturian Navy Summary Header */}
      <div className="bg-[#071E33] px-4 pb-6 pt-4 text-white">
        <p className="text-xs text-[#AFC6DC]">
          Rekap Kas · {selectedSession?.label ?? "Hari Ini"}
        </p>
        <p className="mt-1 text-2xl font-extrabold tabular-nums">
          {formatRupiah(recap.grandTotal)}
        </p>
        <p className="mt-1 text-xs tabular-nums text-[#AFC6DC]">
          Lunas {formatRupiah(recap.grandPaid)} · Sisa{" "}
          <strong className="text-[#FE583E]">
            {formatRupiah(recap.grandTotal - recap.grandPaid)}
          </strong>
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl bg-[#102D47] p-3">
            <p className="text-[11px] font-semibold text-[#AFC6DC]">
              QRIS Pedagang
            </p>
            <p className="mt-1 text-sm font-extrabold tabular-nums">
              {formatRupiah(recap.qrisTotal)}
            </p>
            <p className="text-[11px] tabular-nums text-white/70">
              Lunas {formatRupiah(recap.qrisPaid)}
            </p>
          </div>
          <div className="rounded-2xl bg-[#102D47] p-3">
            <p className="text-[11px] font-semibold text-[#AFC6DC]">
              Cash / Tunai
            </p>
            <p className="mt-1 text-sm font-extrabold tabular-nums">
              {formatRupiah(recap.cashTotal)}
            </p>
            <p className="text-[11px] tabular-nums text-white/70">
              Diterima {formatRupiah(recap.cashPaid)}
            </p>
          </div>
        </div>
      </div>

      {/* Breakdown per OB */}
      <section className="px-4 py-4">
        <h3 className="mb-2 text-sm font-extrabold text-[#071E33]">
          Pembagian 2 Driver
        </h3>
        {recap.byOb.length === 0 ? (
          <p className="text-xs text-[#5B6B7C]">Belum ada pesanan di sesi ini.</p>
        ) : (
          <div className="divide-y divide-[#EDF1F5]">
            {recap.byOb.map((row) => (
              <div
                key={row.name}
                className="flex items-center justify-between py-3 text-xs"
              >
                <div>
                  <p className="font-bold text-[#071E33]">{row.name}</p>
                  <p className="text-[#5B6B7C]">
                    {row.batchCount} warung · {row.orderCount} pesanan
                  </p>
                </div>
                <span className="font-extrabold tabular-nums text-[#071E33]">
                  {formatRupiah(row.total)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="h-2 bg-[#F4F6F9]" />

      {/* Unpaid List */}
      <section className="px-4 py-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-extrabold text-[#071E33]">Belum Lunas</h3>
          <span className="text-xs font-bold text-[#E8472E]">
            {recap.unpaidOrders.length} orang
          </span>
        </div>

        {recap.unpaidOrders.length === 0 ? (
          <p className="py-4 text-xs font-semibold text-[#16884A]">
            Semua pesanan di sesi ini sudah lunas.
          </p>
        ) : (
          <div className="divide-y divide-[#EDF1F5]">
            {recap.unpaidOrders.map((order) => {
              const waLink = order.user_whatsapp
                ? toWaUrl(
                    order.user_whatsapp,
                    `Halo ${order.user_name}, pesanan ${order.merchant_name} totalnya ${formatRupiah(
                      order.effective_total
                    )} (${order.payment_method}). Cek QRIS / pembayaran di aplikasi Abangku Driver ya.`
                  )
                : null;

              return (
                <div
                  key={order.id}
                  className="flex items-center justify-between gap-3 py-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[#071E33]">
                      {order.user_name}
                    </p>
                    <p className="truncate text-[#5B6B7C]">
                      {order.merchant_name} · {order.payment_method}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="font-extrabold tabular-nums text-[#E8472E]">
                      {formatRupiah(order.effective_total)}
                    </span>
                    {waLink && (
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-[#071E33] px-3 py-1 text-[11px] font-bold text-[#071E33]"
                      >
                        Chat WA
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
