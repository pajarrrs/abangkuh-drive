"use client";

import { useState } from "react";
import { formatRupiah } from "@/lib/format";
import type { ObLocationInfo, OrderRecord } from "@/lib/types";
import { ImageModal } from "./ImageModal";
import { formatObStatusText, formatUpdatedAgo, LiveObMap } from "./LiveObMap";

interface EmployeePaymentsTabProps {
  orders: OrderRecord[];
  obLocations: ObLocationInfo[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function EmployeePaymentsTab({
  orders,
  obLocations,
  onRefresh,
  onNotify,
}: EmployeePaymentsTabProps) {
  const [uploadingOrderId, setUploadingOrderId] = useState<number | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const [previewImg, setPreviewImg] = useState<{
    src: string;
    title: string;
    subtitle?: string;
  } | null>(null);

  async function handleUploadProof(orderId: number, file: File) {
    setUploadingOrderId(orderId);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "proof");
      const upRes = await fetch("/api/upload", { method: "POST", body: form });
      const upData = await upRes.json();
      if (!upRes.ok) {
        onNotify(upData.error || "Gagal unggah bukti transfer.", "error");
        return;
      }

      const patchRes = await fetch(`/api/orders/${orderId}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_proof",
          payment_proof_url: upData.url,
        }),
      });
      const patchData = await patchRes.json();
      if (!patchRes.ok) {
        onNotify(patchData.error || "Gagal menyimpan bukti transfer.", "error");
        return;
      }

      await onRefresh();
      onNotify("Bukti transfer terkirim. Menunggu verifikasi Driver.", "success");
    } catch {
      onNotify("Gagal menghubungi server.", "error");
    } finally {
      setUploadingOrderId(null);
    }
  }

  async function handleSwitchMethod(orderId: number, method: "QRIS" | "CASH") {
    setBusyOrderId(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch_method", payment_method: method }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal mengubah metode bayar.", "error");
        return;
      }
      await onRefresh();
      onNotify(`Metode pembayaran diganti ke ${method}.`, "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleCancelOrder(orderId: number) {
    if (!confirm("Batalkan pesanan ini?")) return;
    setBusyOrderId(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal membatalkan pesanan.", "error");
        return;
      }
      await onRefresh();
      onNotify("Pesanan dibatalkan.", "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <div className="bg-white pb-8">
      {/* Header */}
      <div className="bg-[#071E33] px-4 pb-5 pt-4 text-white">
        <h2 className="text-lg font-extrabold">Pesanan & Lacak Driver</h2>
        <p className="mt-0.5 text-xs text-[#AFC6DC]">
          Pantau posisi Driver saat belanja & lihat QRIS khusus warung pilihanmu.
        </p>
      </div>

      {/* Live Driver Tracking Map Section (Gojek/Grab Style) */}
      <section className="border-b-8 border-[#F4F6F9] px-4 py-4">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                obLocations.some((o) => o.is_sharing === 1)
                  ? "animate-pulse bg-[#E8472E]"
                  : "bg-[#94A3B8]"
              }`}
            />
            <h3 className="text-sm font-extrabold text-[#071E33]">
              Lokasi Driver Belanja
            </h3>
          </div>
          <span className="text-[11px] font-semibold text-[#5B6B7C]">
            {obLocations.filter((o) => o.is_sharing === 1).length} dari{" "}
            {obLocations.length} Driver live
          </span>
        </div>

        <LiveObMap locations={obLocations} heightClass="h-52" />

        {obLocations.length > 0 && (
          <div className="mt-3 divide-y divide-[#EDF1F5]">
            {obLocations.map((ob, idx) => {
              const isLive = ob.is_sharing === 1 && ob.lat !== null && ob.lng !== null;
              const badgeBg = idx % 2 === 0 ? "bg-[#E8472E]" : "bg-[#071E33]";
              const gmapsUrl =
                isLive && ob.lat !== null && ob.lng !== null
                  ? `https://www.google.com/maps?q=${ob.lat},${ob.lng}`
                  : null;

              return (
                <div
                  key={ob.ob_id}
                  className="flex items-center justify-between gap-3 py-2.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        isLive ? badgeBg : "bg-[#CBD5E1]"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-extrabold text-[#071E33]">
                        {ob.ob_name}
                      </p>
                      <p className="truncate text-[11px] text-[#5B6B7C]">
                        {isLive
                          ? `${formatObStatusText(
                              ob.status_label,
                              ob.current_merchant_name
                            )}${
                              ob.updated_at
                                ? ` · ${formatUpdatedAgo(ob.updated_at)}`
                                : ""
                            }`
                          : ob.active_merchants.length > 0
                          ? `Handle: ${ob.active_merchants.join(", ")}`
                          : "Belum aktifkan lokasi"}
                      </p>
                    </div>
                  </div>

                  {gmapsUrl && (
                    <a
                      href={gmapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-full border border-[#D7E0E8] px-3 py-1 text-[11px] font-bold text-[#071E33] hover:bg-[#F4F6F9]"
                    >
                      Buka Maps
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {orders.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-sm font-bold text-[#071E33]">
            Belum ada pesanan hari ini
          </p>
          <p className="mt-1 text-xs text-[#5B6B7C]">
            Mulai pesan dari tab <strong>Pesan</strong>. Saat Driver mengunggah QRIS
            pedagang, tagihanmu otomatis muncul di sini.
          </p>
        </div>
      ) : (
        <div className="divide-y-8 divide-[#F4F6F9]">
          {orders.map((order) => {
            const statusMeta = (() => {
              if (order.payment_status === "CANCELLED") {
                return { label: "Dibatalkan / Habis", cls: "bg-[#F1F5F9] text-[#64748B]" };
              }
              if (order.delivery_status === "DELIVERED" && order.payment_status === "PAID") {
                return { label: "Selesai · Lunas", cls: "bg-[#ECFDF3] text-[#16884A]" };
              }
              if (order.payment_status === "PAID") {
                return { label: "Lunas", cls: "bg-[#ECFDF3] text-[#16884A]" };
              }
              if (order.payment_status === "PROOF_UPLOADED") {
                return { label: "Bukti Terkirim", cls: "bg-[#EEF4F9] text-[#071E33]" };
              }
              if (order.payment_status === "WAITING_PAYMENT") {
                return { label: "QRIS Siap Bayar", cls: "bg-[#FFF1EE] text-[#E8472E]" };
              }
              if (order.payment_method === "CASH") {
                return { label: "Bayar Cash", cls: "bg-[#F4F6F9] text-[#071E33]" };
              }
              return { label: "Menunggu QRIS Driver", cls: "bg-[#F4F6F9] text-[#5B6B7C]" };
            })();

            return (
              <section key={order.id} className="px-4 py-4">
                {/* Top Row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#6B7C8F]">
                      {order.session_label}
                      {order.assigned_ob_name ? ` · ${order.assigned_ob_name}` : ""}
                    </p>
                    <h3 className="mt-0.5 truncate text-[15px] font-extrabold text-[#071E33]">
                      {order.merchant_name}
                    </h3>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${statusMeta.cls}`}
                  >
                    {statusMeta.label}
                  </span>
                </div>

                {/* Receipt Items */}
                <ul className="mt-3 space-y-1.5 border-y border-dashed border-[#E2E8F0] py-3">
                  {order.items.map((item) => {
                    const effectiveUnit =
                      item.actual_unit_price !== null
                        ? item.actual_unit_price
                        : item.unit_price;
                    return (
                      <li
                        key={item.id}
                        className={`flex items-start justify-between gap-2 text-xs ${
                          item.is_unavailable
                            ? "text-[#94A3B8] line-through"
                            : "text-[#071E33]"
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="font-semibold">
                            {item.qty}x {item.item_name}
                          </span>
                          {item.is_unavailable === 1 && (
                            <span className="ml-1.5 rounded bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-bold text-[#C81E1E] no-underline">
                              HABIS
                            </span>
                          )}
                          {item.item_note && (
                            <p className="text-[11px] text-[#6B7C8F]">
                              {item.item_note}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 font-bold tabular-nums">
                          {item.is_unavailable
                            ? "Rp0"
                            : formatRupiah(item.qty * effectiveUnit)}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {order.notes && (
                  <p className="mt-2 text-xs text-[#5B6B7C]">
                    Catatan: {order.notes}
                  </p>
                )}

                {/* Total Line */}
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-xs font-medium text-[#5B6B7C]">
                    {order.actual_total !== null ? "Total real" : "Estimasi"} ·{" "}
                    <strong className="text-[#071E33]">{order.payment_method}</strong>
                  </span>
                  <span className="text-base font-extrabold tabular-nums text-[#071E33]">
                    {formatRupiah(order.effective_total)}
                  </span>
                </div>

                {/* Rejection Banner */}
                {order.payment_reject_reason && (
                  <div className="mt-3 rounded-xl bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#C81E1E]">
                    <strong>Bukti ditolak Driver:</strong> {order.payment_reject_reason}
                  </div>
                )}

                {/* Merchant QRIS Card */}
                {order.payment_method === "QRIS" &&
                  order.batch_qris_image_url &&
                  order.payment_status !== "CANCELLED" && (
                    <div className="mt-3 overflow-hidden rounded-2xl border border-[#D7E3EE]">
                      <div className="flex items-center justify-between bg-[#071E33] px-3.5 py-2 text-white">
                        <span className="text-xs font-bold">
                          QRIS {order.merchant_name}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewImg({
                              src: order.batch_qris_image_url!,
                              title: `QRIS ${order.merchant_name}`,
                              subtitle: `Transfer ${formatRupiah(order.effective_total)}`,
                            })
                          }
                          className="text-[11px] font-bold text-[#AFC6DC] underline"
                        >
                          Perbesar
                        </button>
                      </div>

                      <div className="bg-[#F8FAFC] p-3.5">
                        {order.batch_ob_note && (
                          <p className="mb-2.5 text-xs text-[#5B6B7C]">
                            Info Driver: {order.batch_ob_note}
                          </p>
                        )}

                        <div className="flex items-center gap-3.5">
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewImg({
                                src: order.batch_qris_image_url!,
                                title: `QRIS ${order.merchant_name}`,
                                subtitle: `Transfer ${formatRupiah(order.effective_total)}`,
                              })
                            }
                            className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white p-1"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={order.batch_qris_image_url}
                              alt="QRIS Pedagang"
                              className="h-full w-full object-contain"
                            />
                          </button>

                          <div className="flex-1 space-y-2">
                            <a
                              href={order.batch_qris_image_url}
                              download
                              className="block w-full rounded-full border border-[#071E33] bg-white py-2 text-center text-xs font-bold text-[#071E33]"
                            >
                              Simpan QRIS
                            </a>

                            {order.payment_status !== "PAID" && (
                              <label className="block w-full cursor-pointer rounded-full bg-[#E8472E] py-2 text-center text-xs font-bold text-white hover:bg-[#D13B24]">
                                {uploadingOrderId === order.id
                                  ? "Mengunggah..."
                                  : order.payment_proof_url
                                  ? "Ganti Bukti Transfer"
                                  : "Upload Bukti Transfer"}
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp"
                                  className="hidden"
                                  disabled={uploadingOrderId === order.id}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleUploadProof(order.id, file);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        </div>

                        {order.payment_proof_url && (
                          <div className="mt-3 flex items-center justify-between border-t border-[#E2E8F0] pt-2.5 text-xs">
                            <span className="font-semibold text-[#16884A]">
                              Bukti transfer terlampir
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewImg({
                                  src: order.payment_proof_url!,
                                  title: "Bukti Transfer",
                                  subtitle: `${order.merchant_name} · ${formatRupiah(order.effective_total)}`,
                                })
                              }
                              className="font-bold text-[#071E33] underline"
                            >
                              Lihat bukti
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                {order.batch_receipt_image_url && (
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewImg({
                        src: order.batch_receipt_image_url!,
                        title: `Struk ${order.merchant_name}`,
                      })
                    }
                    className="mt-2.5 w-full rounded-full border border-[#D7E0E8] py-2 text-xs font-bold text-[#071E33]"
                  >
                    Lihat Foto Struk Belanja
                  </button>
                )}

                {order.payment_method === "QRIS" &&
                  !order.batch_qris_image_url &&
                  order.payment_status !== "CANCELLED" && (
                    <p className="mt-3 rounded-xl bg-[#F4F6F9] px-3.5 py-2.5 text-xs text-[#5B6B7C]">
                      QRIS akan muncul otomatis di sini saat Driver tiba di warung.
                    </p>
                  )}

                {order.delivery_status === "DELIVERED" && (
                  <p className="mt-3 rounded-xl bg-[#ECFDF3] px-3.5 py-2.5 text-xs font-bold text-[#16884A]">
                    Pesanan sudah diantar Driver.
                  </p>
                )}

                {order.payment_status !== "PAID" &&
                  order.payment_status !== "CANCELLED" && (
                    <div className="mt-3 flex items-center justify-between pt-1">
                      <button
                        type="button"
                        disabled={busyOrderId === order.id}
                        onClick={() =>
                          handleSwitchMethod(
                            order.id,
                            order.payment_method === "QRIS" ? "CASH" : "QRIS"
                          )
                        }
                        className="text-xs font-bold text-[#5B6B7C] underline"
                      >
                        Ubah ke {order.payment_method === "QRIS" ? "Cash" : "QRIS"}
                      </button>

                      {order.batch_status === "COLLECTING" &&
                        order.payment_status !== "PROOF_UPLOADED" && (
                          <button
                            type="button"
                            disabled={busyOrderId === order.id}
                            onClick={() => handleCancelOrder(order.id)}
                            className="text-xs font-bold text-[#C81E1E]"
                          >
                            Batalkan
                          </button>
                        )}
                    </div>
                  )}
              </section>
            );
          })}
        </div>
      )}

      {previewImg && (
        <ImageModal
          src={previewImg.src}
          title={previewImg.title}
          subtitle={previewImg.subtitle}
          onClose={() => setPreviewImg(null)}
        />
      )}
    </div>
  );
}
