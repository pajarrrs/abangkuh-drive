"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { formatRupiah } from "@/lib/format";
import { getSessionTimeState } from "@/lib/notifications";
import type {
  MerchantBatch,
  ObLocationInfo,
  OrderRecord,
  OrderSession,
  SessionStatus,
  UserProfile,
} from "@/lib/types";
import { ImageModal } from "./ImageModal";
import { OBLocationControl } from "./OBLocationControl";

interface OBDashboardTabProps {
  currentUser: UserProfile;
  sessions: OrderSession[];
  selectedSessionId: number | null;
  onSelectSession: (id: number) => void;
  currentTimeWib: string;
  batches: MerchantBatch[];
  obLocations: ObLocationInfo[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function OBDashboardTab({
  currentUser,
  sessions,
  selectedSessionId,
  onSelectSession,
  currentTimeWib,
  batches,
  obLocations,
  onRefresh,
  onNotify,
}: OBDashboardTabProps) {
  const [filter, setFilter] = useState<"all" | "mine" | "unclaimed">("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [qrisModalBatch, setQrisModalBatch] = useState<MerchantBatch | null>(null);
  const [bulkOrdersDraft, setBulkOrdersDraft] = useState<
    Array<{
      order_id: number;
      user_name: string;
      items_label: string;
      single_item_key: string | null;
      single_item_qty: number;
      max_budget: number | null;
      payment_method: "QRIS" | "CASH";
      actual_total: number;
      is_unavailable: boolean;
    }>
  >([]);
  const [qrisUrl, setQrisUrl] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [obNote, setObNote] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [uploadingFile, setUploadingFile] = useState<"qris" | "receipt" | null>(null);

  const [priceModalOrder, setPriceModalOrder] = useState<OrderRecord | null>(null);
  const [priceDraft, setPriceDraft] = useState<
    Array<{
      id: number;
      item_name: string;
      qty: number;
      actual_unit_price: number;
      is_unavailable: boolean;
    }>
  >([]);

  const [verifyOrder, setVerifyOrder] = useState<OrderRecord | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);

  const [previewImg, setPreviewImg] = useState<{
    src: string;
    title: string;
    subtitle?: string;
  } | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId]
  );

  const filteredBatches = useMemo(() => {
    return batches.filter((b) => {
      if (filter === "mine") return b.assigned_ob_id === currentUser.id;
      if (filter === "unclaimed") return b.assigned_ob_id === null;
      return true;
    });
  }, [batches, filter, currentUser.id]);

  const stats = useMemo(() => {
    let ordersCount = 0;
    let pendingVerify = 0;
    let grandTotal = 0;
    for (const b of batches) {
      ordersCount += b.summary.order_count;
      pendingVerify += b.summary.pending_verification_count;
      grandTotal += b.summary.grand_total;
    }
    return {
      batchesCount: batches.length,
      ordersCount,
      pendingVerify,
      grandTotal,
    };
  }, [batches]);

  async function updateSessionStatus(status: SessionStatus) {
    if (!selectedSession) return;
    setBusyId(`session-${status}`);
    try {
      const res = await fetch(`/api/sessions/${selectedSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal mengubah status sesi.", "error");
        return;
      }
      await onRefresh();
      const label =
        status === "OPEN"
          ? "Sesi dibuka untuk pesanan."
          : status === "SHOPPING"
          ? "Order ditutup. Selamat berbelanja."
          : "Sesi selesai.";
      onNotify(label, "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleClaimBatch(batch: MerchantBatch, release: boolean) {
    setBusyId(`claim-${batch.id}`);
    try {
      const res = await fetch(`/api/batches/${batch.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ release }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal mengubah penugasan.", "error");
        return;
      }
      await onRefresh();
      onNotify(
        release
          ? `Warung ${batch.merchant_name} dilepas.`
          : `Kamu mengambil warung ${batch.merchant_name}.`,
        "success"
      );
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setBusyId(null);
    }
  }

  function openQrisModal(batch: MerchantBatch) {
    setQrisModalBatch(batch);
    const activeOrders = batch.orders.filter(
      (o) => o.payment_status !== "CANCELLED"
    );
    setBulkOrdersDraft(
      activeOrders.map((o) => {
        const activeItems = o.items.filter((i) => i.is_unavailable === 0);
        const isSingle = activeItems.length === 1;
        return {
          order_id: o.id,
          user_name: o.user_name || "Pemesan",
          items_label: activeItems
            .map((i) => `${i.qty}x ${i.item_name}`)
            .join(", "),
          single_item_key: isSingle
            ? activeItems[0].item_name.trim().toLowerCase()
            : null,
          single_item_qty: isSingle ? activeItems[0].qty : 1,
          max_budget: o.max_budget ?? null,
          payment_method: o.payment_method,
          actual_total: o.effective_total,
          is_unavailable: false,
        };
      })
    );
    setQrisUrl(batch.qris_image_url || batch.merchant_default_qris || null);
    setReceiptUrl(batch.receipt_image_url || null);
    setObNote(batch.ob_note || "");
    setSaveAsDefault(Boolean(batch.merchant_id));
  }

  function updateBulkOrderPrice(index: number, newTotal: number) {
    setBulkOrdersDraft((prev) => {
      const target = prev[index];
      if (!target) return prev;
      const oldTotal = target.actual_total;
      const unitPrice =
        target.single_item_key && target.single_item_qty > 0
          ? Math.round(newTotal / target.single_item_qty)
          : null;

      return prev.map((row, i) => {
        if (i === index) return { ...row, actual_total: newTotal };
        // Auto-sync identical single-item orders whose price was still unset or matched old unit
        if (
          unitPrice !== null &&
          row.single_item_key === target.single_item_key &&
          !row.is_unavailable &&
          (row.actual_total === 0 ||
            row.actual_total ===
              Math.round((oldTotal / Math.max(1, target.single_item_qty)) * row.single_item_qty))
        ) {
          return { ...row, actual_total: unitPrice * row.single_item_qty };
        }
        return row;
      });
    });
  }

  async function copyBatchSummary(batch: MerchantBatch) {
    const activeOrders = batch.orders.filter(
      (o) => o.payment_status !== "CANCELLED"
    );
    const lines = [
      `*${batch.merchant_name}* — Tagihan & QRIS sudah masuk di Abangku Driver:`,
      ...activeOrders.map((o) => {
        const status = o.payment_status === "PAID" ? " ✅ Lunas" : "";
        return `• ${o.user_name}: ${formatRupiah(o.effective_total)} (${o.payment_method})${status}`;
      }),
      `Total: ${formatRupiah(batch.summary.grand_total)}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      onNotify("Ringkasan tagihan warung disalin!", "success");
    } catch {
      onNotify("Gagal menyalin teks ke clipboard.", "error");
    }
  }

  async function handleFileUpload(file: File, kind: "qris" | "receipt") {
    setUploadingFile(kind);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal mengunggah gambar.", "error");
        return;
      }
      if (kind === "qris") setQrisUrl(data.url);
      else setReceiptUrl(data.url);
      onNotify(
        kind === "qris" ? "Foto QRIS siap dikirim." : "Foto struk terunggah.",
        "success"
      );
    } catch {
      onNotify("Gagal unggah gambar.", "error");
    } finally {
      setUploadingFile(null);
    }
  }

  async function submitBatchQris() {
    if (!qrisModalBatch) return;
    const hasQrisOrder = bulkOrdersDraft.some(
      (o) => !o.is_unavailable && o.payment_method === "QRIS"
    );
    if (hasQrisOrder && !qrisUrl) {
      onNotify("Upload foto QRIS pedagang dulu (ada pemesan QRIS).", "error");
      return;
    }

    setBusyId(`qris-save-${qrisModalBatch.id}`);
    try {
      const res = await fetch(`/api/batches/${qrisModalBatch.id}/bulk-price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orders: bulkOrdersDraft.map((o) => ({
            order_id: o.order_id,
            actual_total: o.actual_total,
            is_unavailable: o.is_unavailable,
          })),
          qris_image_url: qrisUrl,
          receipt_image_url: receiptUrl,
          ob_note: obNote.trim(),
          save_as_default: saveAsDefault,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal menyimpan harga & QRIS.", "error");
        return;
      }
      setQrisModalBatch(null);
      await onRefresh();
      onNotify(
        `Harga & tagihan ${qrisModalBatch.merchant_name} langsung terkirim ke semua pemesan!`,
        "success"
      );
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setBusyId(null);
    }
  }

  function openPriceEditor(order: OrderRecord) {
    setPriceModalOrder(order);
    setPriceDraft(
      order.items.map((it) => ({
        id: it.id,
        item_name: it.item_name,
        qty: it.qty,
        actual_unit_price:
          it.actual_unit_price !== null ? it.actual_unit_price : it.unit_price,
        is_unavailable: it.is_unavailable === 1,
      }))
    );
  }

  async function saveActualPrices() {
    if (!priceModalOrder) return;
    setBusyId(`price-${priceModalOrder.id}`);
    try {
      const res = await fetch(`/api/orders/${priceModalOrder.id}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_prices",
          items: priceDraft.map((i) => ({
            id: i.id,
            actual_unit_price: i.actual_unit_price,
            is_unavailable: i.is_unavailable,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal menyimpan harga real.", "error");
        return;
      }
      setPriceModalOrder(null);
      await onRefresh();
      onNotify("Harga real diperbarui.", "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmOrderPaid(orderId: number) {
    setBusyId(`paid-${orderId}`);
    try {
      const res = await fetch(`/api/orders/${orderId}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm_paid" }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal konfirmasi lunas.", "error");
        return;
      }
      setVerifyOrder(null);
      await onRefresh();
      onNotify("Pembayaran dikonfirmasi lunas.", "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function rejectOrderProof(orderId: number) {
    if (rejectReason.trim().length < 2) {
      onNotify("Tulis alasan penolakan dulu.", "error");
      return;
    }
    setBusyId(`reject-${orderId}`);
    try {
      const res = await fetch(`/api/orders/${orderId}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject_proof",
          reason: rejectReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal menolak bukti.", "error");
        return;
      }
      setVerifyOrder(null);
      setRejectReason("");
      setShowRejectBox(false);
      await onRefresh();
      onNotify("Bukti ditolak. Pemesan diminta upload ulang.", "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function completeBatch(batch: MerchantBatch) {
    setBusyId(`complete-${batch.id}`);
    try {
      const res = await fetch(`/api/batches/${batch.id}/complete`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal menyelesaikan batch.", "error");
        return;
      }
      await onRefresh();
      onNotify(`Semua pesanan ${batch.merchant_name} ditandai sudah diantar.`, "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-white pb-8">
      {/* Alturian Navy OB Control Header */}
      <div className="bg-[#071E33] px-4 pb-5 pt-3 text-white">
        <div className="flex items-center justify-between text-xs">
          <div>
            <p className="text-[11px] text-[#AFC6DC]">Mode Abangku Driver</p>
            <p className="font-extrabold text-white">{currentUser.name}</p>
          </div>
          <span className="rounded-full bg-[#102D47] px-3 py-1 text-[11px] font-semibold tabular-nums text-[#AFC6DC]">
            {currentTimeWib} WIB
          </span>
        </div>

        {/* Session Selector */}
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          {sessions.map((s) => {
            const active = s.id === selectedSession?.id;
            const timeState = getSessionTimeState(s.open_time, s.close_time);
            const pastHint =
              s.status === "OPEN" && timeState === "PAST" ? " · Lewat jam" : "";
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSession(s.id)}
                className={`rounded-2xl px-3 py-2.5 text-left transition ${
                  active
                    ? "bg-white text-[#071E33]"
                    : "bg-[#102D47] text-white/80 hover:bg-[#163A59]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold">
                    Sesi {s.slot === "SIANG" ? "Siang" : "Sore"}
                  </span>
                  <span
                    className={`text-[11px] font-bold tabular-nums ${
                      active ? "text-[#E8472E]" : "text-[#AFC6DC]"
                    }`}
                  >
                    {s.order_count ?? 0} order
                  </span>
                </div>
                <p
                  className={`mt-0.5 text-[11px] tabular-nums ${
                    pastHint
                      ? "font-bold text-[#E8472E]"
                      : active
                      ? "text-[#5B6B7C]"
                      : "text-[#AFC6DC]"
                  }`}
                >
                  {s.open_time} – {s.close_time} WIB{pastHint}
                </p>
              </button>
            );
          })}
        </div>

        {/* 3-State Session Status Control */}
        {selectedSession && (
          <div className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-[#102D47] p-1">
            {(
              [
                { key: "OPEN", label: "Buka Order" },
                { key: "SHOPPING", label: "Belanja" },
                { key: "COMPLETED", label: "Selesai" },
              ] as Array<{ key: SessionStatus; label: string }>
            ).map((opt) => {
              const active = selectedSession.status === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={busyId === `session-${opt.key}`}
                  onClick={() => updateSessionStatus(opt.key)}
                  className={`rounded-full py-1.5 text-xs font-bold transition ${
                    active
                      ? opt.key === "OPEN"
                        ? "bg-[#16884A] text-white"
                        : opt.key === "SHOPPING"
                        ? "bg-[#E8472E] text-white"
                        : "bg-white text-[#071E33]"
                      : "text-[#AFC6DC] hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Live GPS Sharing (strictly device GPS, OB role only) */}
      {currentUser.role === "OB" && (
        <OBLocationControl
          currentUser={currentUser}
          myLocation={
            obLocations.find((l) => l.ob_id === currentUser.id) ?? null
          }
          myBatches={batches.filter((b) => b.assigned_ob_id === currentUser.id)}
          onUpdated={onRefresh}
          onNotify={onNotify}
        />
      )}

      {/* Clean KPI Strip */}
      <div className="grid grid-cols-3 divide-x divide-[#EDF1F5] border-b border-[#EDF1F5] bg-white py-3 text-center">
        <div>
          <p className="text-[11px] font-medium text-[#6B7C8F]">Warung · Order</p>
          <p className="mt-0.5 text-sm font-extrabold tabular-nums text-[#071E33]">
            {stats.batchesCount} · {stats.ordersCount}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-[#6B7C8F]">Cek Bukti</p>
          <p
            className={`mt-0.5 text-sm font-extrabold tabular-nums ${
              stats.pendingVerify > 0 ? "text-[#E8472E]" : "text-[#071E33]"
            }`}
          >
            {stats.pendingVerify}
          </p>
        </div>
        <div className="px-2">
          <p className="text-[11px] font-medium text-[#6B7C8F]">Total Sesi</p>
          <p className="mt-0.5 truncate text-sm font-extrabold tabular-nums text-[#071E33]">
            {formatRupiah(stats.grandTotal)}
          </p>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
        {(
          [
            { key: "all", label: `Semua (${batches.length})` },
            {
              key: "mine",
              label: `Tugas Saya (${
                batches.filter((b) => b.assigned_ob_id === currentUser.id).length
              })`,
            },
            {
              key: "unclaimed",
              label: `Belum Diambil (${
                batches.filter((b) => b.assigned_ob_id === null).length
              })`,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition ${
              filter === tab.key
                ? "bg-[#071E33] text-white"
                : "bg-[#F4F6F9] text-[#475569]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="h-2 bg-[#F4F6F9]" />

      {/* Merchant Batch List */}
      {filteredBatches.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <p className="text-sm font-bold text-[#071E33]">
            Belum ada pesanan di filter ini
          </p>
          <p className="mt-1 text-xs text-[#5B6B7C]">
            Pesanan dari warung yang sama akan otomatis dikelompokkan di sini.
          </p>
        </div>
      ) : (
        <div className="divide-y-8 divide-[#F4F6F9]">
          {filteredBatches.map((batch) => {
            const isMine = batch.assigned_ob_id === currentUser.id;
            const qrisOrdersCount = batch.orders.filter(
              (o) => o.payment_method === "QRIS" && o.payment_status !== "CANCELLED"
            ).length;

            return (
              <section key={batch.id} className="bg-white">
                {/* Batch Top Header */}
                <div className="border-b border-[#EDF1F5] px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-extrabold text-[#071E33]">
                        {batch.merchant_name}
                      </h3>
                      <p className="mt-0.5 text-xs tabular-nums text-[#5B6B7C]">
                        {batch.summary.order_count} pesanan ·{" "}
                        <strong className="text-[#071E33]">
                          {formatRupiah(batch.summary.grand_total)}
                        </strong>
                      </p>
                    </div>

                    {batch.assigned_ob_id === null ? (
                      <button
                        type="button"
                        disabled={busyId === `claim-${batch.id}`}
                        onClick={() => toggleClaimBatch(batch, false)}
                        className="shrink-0 rounded-full bg-[#071E33] px-3.5 py-1.5 text-xs font-bold text-white"
                      >
                        Ambil Warung
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            isMine
                              ? "bg-[#EEF4F9] text-[#071E33]"
                              : "bg-[#F4F6F9] text-[#5B6B7C]"
                          }`}
                        >
                          {isMine ? "Tugas Saya" : batch.assigned_ob_name}
                        </span>
                        {isMine && batch.status !== "COMPLETED" && (
                          <button
                            type="button"
                            onClick={() => toggleClaimBatch(batch, true)}
                            className="text-[11px] font-bold text-[#6B7C8F] underline"
                          >
                            Lepas
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Bulk Price + QRIS + Copy Summary Row */}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openQrisModal(batch)}
                      className={`flex-1 rounded-full py-2 text-xs font-bold transition ${
                        batch.qris_image_url
                          ? "border border-[#16884A] bg-[#ECFDF3] text-[#16884A]"
                          : "bg-[#E8472E] text-white hover:bg-[#D13B24]"
                      }`}
                    >
                      {batch.qris_image_url
                        ? `Harga & QRIS Terkirim (${qrisOrdersCount}) · Edit`
                        : `Input Harga & Kirim QRIS`}
                    </button>

                    <button
                      type="button"
                      onClick={() => copyBatchSummary(batch)}
                      className="rounded-full border border-[#D7E0E8] px-3 py-2 text-xs font-bold text-[#071E33] hover:bg-[#F4F6F9]"
                    >
                      Salin Rekap
                    </button>

                    {batch.qris_image_url && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewImg({
                            src: batch.qris_image_url!,
                            title: `QRIS ${batch.merchant_name}`,
                            subtitle: batch.ob_note || undefined,
                          })
                        }
                        className="rounded-full border border-[#D7E0E8] px-3 py-2 text-xs font-bold text-[#071E33]"
                      >
                        QRIS
                      </button>
                    )}
                  </div>
                </div>

                {/* Orders inside Batch */}
                <div className="divide-y divide-[#EDF1F5]">
                  {batch.orders.map((order) => (
                    <div key={order.id} className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-extrabold text-[#071E33]">
                            {order.user_name}
                          </p>
                          <ul className="mt-1 space-y-0.5 text-xs text-[#334155]">
                            {order.items.map((item) => (
                              <li
                                key={item.id}
                                className={
                                  item.is_unavailable
                                    ? "text-[#94A3B8] line-through"
                                    : ""
                                }
                              >
                                <span className="font-semibold">
                                  {item.qty}x {item.item_name}
                                </span>
                                {item.item_note && (
                                  <span className="text-[#6B7C8F]">
                                    {" "}
                                    ({item.item_note})
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                          {order.max_budget && (
                            <p className="mt-1 text-[11px] font-bold text-[#B45309]">
                              Batas maks: {formatRupiah(order.max_budget)}
                            </p>
                          )}
                          {order.notes && (
                            <p className="mt-1 text-[11px] text-[#6B7C8F]">
                              Catatan: {order.notes}
                            </p>
                          )}
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-sm font-extrabold tabular-nums text-[#071E33]">
                            {formatRupiah(order.effective_total)}
                          </p>
                          <p className="mt-0.5 text-[11px] font-bold">
                            <span className="text-[#5B6B7C]">
                              {order.payment_method} ·{" "}
                            </span>
                            <span
                              className={
                                order.payment_status === "PAID"
                                  ? "text-[#16884A]"
                                  : order.payment_status === "PROOF_UPLOADED"
                                  ? "text-[#E8472E]"
                                  : order.payment_status === "CANCELLED"
                                  ? "text-[#94A3B8]"
                                  : "text-[#B45309]"
                              }
                            >
                              {order.payment_status === "PAID"
                                ? "Lunas"
                                : order.payment_status === "PROOF_UPLOADED"
                                ? "Cek Bukti"
                                : order.payment_status === "CANCELLED"
                                ? "Batal"
                                : "Belum"}
                            </span>
                          </p>
                        </div>
                      </div>

                      {order.payment_status !== "CANCELLED" && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openPriceEditor(order)}
                            className="rounded-full border border-[#D7E0E8] px-3 py-1 text-[11px] font-bold text-[#071E33] hover:bg-[#F4F6F9]"
                          >
                            {order.actual_total !== null
                              ? "Ubah Harga"
                              : "Harga Real / Habis"}
                          </button>

                          {order.payment_status === "PROOF_UPLOADED" && (
                            <button
                              type="button"
                              onClick={() => {
                                setVerifyOrder(order);
                                setShowRejectBox(false);
                                setRejectReason("");
                              }}
                              className="rounded-full bg-[#E8472E] px-3.5 py-1 text-[11px] font-bold text-white"
                            >
                              Verifikasi Bukti
                            </button>
                          )}

                          {order.payment_status !== "PAID" &&
                            order.payment_method === "CASH" && (
                              <button
                                type="button"
                                disabled={busyId === `paid-${order.id}`}
                                onClick={() => confirmOrderPaid(order.id)}
                                className="rounded-full bg-[#16884A] px-3.5 py-1 text-[11px] font-bold text-white"
                              >
                                Terima Cash
                              </button>
                            )}

                          {order.payment_status !== "PAID" &&
                            order.payment_method === "QRIS" &&
                            order.payment_status !== "PROOF_UPLOADED" && (
                              <button
                                type="button"
                                disabled={busyId === `paid-${order.id}`}
                                onClick={() => confirmOrderPaid(order.id)}
                                className="rounded-full border border-[#16884A] px-3 py-1 text-[11px] font-bold text-[#16884A]"
                              >
                                Tandai Lunas
                              </button>
                            )}

                          {order.delivery_status === "DELIVERED" && (
                            <span className="ml-auto text-[11px] font-bold text-[#16884A]">
                              Diantar
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Batch Footer */}
                <div className="border-t border-[#EDF1F5] px-4 py-3">
                  {batch.status !== "COMPLETED" ? (
                    <button
                      type="button"
                      disabled={busyId === `complete-${batch.id}`}
                      onClick={() => completeBatch(batch)}
                      className="w-full rounded-full bg-[#071E33] py-2.5 text-xs font-bold text-white hover:bg-[#102D47] disabled:opacity-60"
                    >
                      Selesai Beli & Tandai Semua Diantar
                    </button>
                  ) : (
                    <p className="text-center text-xs font-bold text-[#16884A]">
                      Selesai & sudah diantar
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Upload QRIS Pedagang Sheet */}
      {qrisModalBatch && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#071E33]/65 sm:items-center sm:p-4"
          onClick={() => setQrisModalBatch(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#EDF1F5] px-5 py-4">
              <div>
                <p className="text-[11px] font-bold text-[#E8472E]">
                  Input Harga Sekali Jalan & Kirim Tagihan
                </p>
                <h3 className="text-base font-extrabold text-[#071E33]">
                  {qrisModalBatch.merchant_name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQrisModalBatch(null)}
                className="rounded-full p-1.5 text-[#5B6B7C] hover:bg-[#F4F6F9]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {/* Bulk Order Price Inputs (1 Screen for All Buyers at This Merchant) */}
              {bulkOrdersDraft.length > 0 && (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-xs font-extrabold text-[#071E33]">
                      Harga Real per Pemesan ({bulkOrdersDraft.length})
                    </span>
                    <span className="text-[11px] text-[#5B6B7C]">
                      Item sama otomatis ikut terisi
                    </span>
                  </div>
                  <div className="divide-y divide-[#EDF1F5] rounded-2xl border border-[#E2E8F0] px-3.5">
                    {bulkOrdersDraft.map((row, idx) => {
                      const overBudget =
                        !row.is_unavailable &&
                        row.max_budget !== null &&
                        row.actual_total > row.max_budget;
                      return (
                        <div key={row.order_id} className="py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-extrabold text-[#071E33]">
                                {row.user_name}{" "}
                                <span className="font-semibold text-[#6B7C8F]">
                                  · {row.payment_method}
                                </span>
                              </p>
                              <p
                                className={`mt-0.5 text-[11px] ${
                                  row.is_unavailable
                                    ? "text-[#94A3B8] line-through"
                                    : "text-[#5B6B7C]"
                                }`}
                              >
                                {row.items_label}
                              </p>
                            </div>
                            <label className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-[#C81E1E]">
                              <input
                                type="checkbox"
                                checked={row.is_unavailable}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setBulkOrdersDraft((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? { ...item, is_unavailable: checked }
                                        : item
                                    )
                                  );
                                }}
                                className="h-3.5 w-3.5 accent-[#C81E1E]"
                              />
                              Habis
                            </label>
                          </div>

                          {!row.is_unavailable && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-xs font-bold text-[#5B6B7C]">Rp</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={row.actual_total > 0 ? String(row.actual_total) : ""}
                                placeholder="Isi total real"
                                onChange={(e) => {
                                  const val = parseInt(
                                    e.target.value.replace(/\D/g, "") || "0",
                                    10
                                  );
                                  updateBulkOrderPrice(idx, val);
                                }}
                                className={`w-32 rounded-xl border px-3 py-1.5 text-xs font-extrabold tabular-nums outline-none ${
                                  overBudget
                                    ? "border-[#E8472E] bg-[#FFF1EE] text-[#C7331D]"
                                    : "border-[#D7E0E8] bg-[#F8FAFC] text-[#071E33] focus:border-[#071E33] focus:bg-white"
                                }`}
                              />
                              {row.max_budget !== null && (
                                <span
                                  className={`text-[11px] font-bold ${
                                    overBudget ? "text-[#C7331D]" : "text-[#5B6B7C]"
                                  }`}
                                >
                                  {overBudget
                                    ? `Lebih dari maks ${formatRupiah(row.max_budget)}`
                                    : `Maks ${formatRupiah(row.max_budget)}`}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-bold text-[#071E33]">
                  Foto QRIS Pedagang{" "}
                  {bulkOrdersDraft.some(
                    (o) => !o.is_unavailable && o.payment_method === "QRIS"
                  )
                    ? "*"
                    : "(Opsional · semua Cash)"}
                </label>
                {qrisUrl ? (
                  <div className="flex items-center gap-3.5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrisUrl}
                      alt="Preview QRIS"
                      className="h-24 w-24 rounded-xl border border-[#E2E8F0] bg-white object-contain p-1"
                    />
                    <div className="flex-1 space-y-2">
                      <p className="text-xs font-bold text-[#16884A]">
                        Foto QRIS siap dikirim
                      </p>
                      <label className="inline-block cursor-pointer rounded-full border border-[#071E33] bg-white px-4 py-1.5 text-xs font-bold text-[#071E33]">
                        Ganti Foto
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleFileUpload(f, "qris");
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-[#AFC6DC] bg-[#F8FAFC] px-4 py-8 text-center hover:border-[#071E33]">
                    <span className="block text-sm font-bold text-[#071E33]">
                      {uploadingFile === "qris"
                        ? "Mengunggah foto QRIS..."
                        : "Pilih / Foto QRIS Pedagang"}
                    </span>
                    <span className="mt-1 block text-xs text-[#5B6B7C]">
                      Format JPG, PNG, atau WEBP (maks. 5MB)
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      capture="environment"
                      className="hidden"
                      disabled={uploadingFile === "qris"}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFileUpload(f, "qris");
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}

                {qrisModalBatch.merchant_id && (
                  <label className="mt-2.5 flex items-center gap-2 text-xs text-[#475569]">
                    <input
                      type="checkbox"
                      checked={saveAsDefault}
                      onChange={(e) => setSaveAsDefault(e.target.checked)}
                      className="h-4 w-4 accent-[#071E33]"
                    />
                    Simpan QRIS ini untuk sesi berikutnya
                  </label>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-[#071E33]">
                  Foto Struk (Opsional)
                </label>
                <div className="flex items-center gap-3">
                  <label className="inline-block cursor-pointer rounded-full border border-[#D7E0E8] px-4 py-2 text-xs font-bold text-[#071E33]">
                    {uploadingFile === "receipt"
                      ? "Mengunggah..."
                      : receiptUrl
                      ? "Ganti Struk"
                      : "Upload Foto Struk"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      capture="environment"
                      className="hidden"
                      disabled={uploadingFile === "receipt"}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFileUpload(f, "receipt");
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {receiptUrl && (
                    <span className="text-xs font-bold text-[#16884A]">
                      Struk terlampir
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-[#071E33]">
                  Info untuk Pemesan (Opsional)
                </label>
                <input
                  type="text"
                  value={obNote}
                  onChange={(e) => setObNote(e.target.value)}
                  placeholder="Misal: QRIS a.n. RM Padang Jaya"
                  className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-xs outline-none focus:border-[#071E33] focus:bg-white"
                />
              </div>
            </div>

            <div className="border-t border-[#EDF1F5] bg-white px-5 py-3.5">
              <div className="mb-2.5 flex items-baseline justify-between text-xs">
                <span className="text-[#5B6B7C]">Total Warung Ini</span>
                <span className="text-base font-extrabold tabular-nums text-[#071E33]">
                  {formatRupiah(
                    bulkOrdersDraft.reduce(
                      (s, r) => s + (r.is_unavailable ? 0 : r.actual_total),
                      0
                    )
                  )}
                </span>
              </div>
              <button
                type="button"
                disabled={busyId === `qris-save-${qrisModalBatch.id}`}
                onClick={submitBatchQris}
                className="w-full rounded-full bg-[#E8472E] py-3.5 text-sm font-bold text-white hover:bg-[#D13B24] disabled:opacity-50"
              >
                {busyId === `qris-save-${qrisModalBatch.id}`
                  ? "Menyimpan..."
                  : "Simpan Harga & Kirim Tagihan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Actual Price Sheet */}
      {priceModalOrder && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#071E33]/65 sm:items-center sm:p-4"
          onClick={() => setPriceModalOrder(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#EDF1F5] px-5 py-4">
              <div>
                <p className="text-[11px] font-bold text-[#E8472E]">
                  Harga Real Warung
                </p>
                <h3 className="text-sm font-extrabold text-[#071E33]">
                  {priceModalOrder.user_name} · {priceModalOrder.merchant_name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPriceModalOrder(null)}
                className="rounded-full p-1.5 text-[#5B6B7C] hover:bg-[#F4F6F9]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[60vh] divide-y divide-[#EDF1F5] overflow-y-auto px-5 py-2">
              {priceDraft.map((item, idx) => (
                <div key={item.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#071E33]">
                      {item.qty}x {item.item_name}
                    </span>
                    <label className="flex items-center gap-1.5 text-xs font-bold text-[#C81E1E]">
                      <input
                        type="checkbox"
                        checked={item.is_unavailable}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setPriceDraft((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, is_unavailable: checked } : row
                            )
                          );
                        }}
                        className="h-4 w-4 accent-[#C81E1E]"
                      />
                      Habis
                    </label>
                  </div>
                  {!item.is_unavailable && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-[#5B6B7C]">Satuan Rp</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={String(item.actual_unit_price)}
                        onChange={(e) => {
                          const val = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
                          setPriceDraft((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, actual_unit_price: val } : row
                            )
                          );
                        }}
                        className="w-28 rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3 py-1.5 text-xs font-bold tabular-nums outline-none focus:border-[#071E33] focus:bg-white"
                      />
                      <span className="ml-auto text-xs font-extrabold tabular-nums text-[#071E33]">
                        {formatRupiah(item.qty * item.actual_unit_price)}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-[#EDF1F5] bg-white px-5 py-3.5">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-xs font-medium text-[#5B6B7C]">
                  Total real baru
                </span>
                <span className="text-base font-extrabold tabular-nums text-[#071E33]">
                  {formatRupiah(
                    priceDraft.reduce(
                      (s, i) => s + (i.is_unavailable ? 0 : i.qty * i.actual_unit_price),
                      0
                    )
                  )}
                </span>
              </div>
              <button
                type="button"
                disabled={busyId === `price-${priceModalOrder.id}`}
                onClick={saveActualPrices}
                className="w-full rounded-full bg-[#071E33] py-3 text-sm font-bold text-white"
              >
                Simpan Harga Real
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verify QRIS Proof Sheet */}
      {verifyOrder && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#071E33]/75 sm:items-center sm:p-4"
          onClick={() => setVerifyOrder(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#EDF1F5] px-5 py-4">
              <div>
                <p className="text-[11px] font-bold text-[#E8472E]">
                  Verifikasi Bukti Transfer
                </p>
                <h3 className="text-sm font-extrabold tabular-nums text-[#071E33]">
                  {verifyOrder.user_name} · {formatRupiah(verifyOrder.effective_total)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setVerifyOrder(null)}
                className="rounded-full p-1.5 text-[#5B6B7C] hover:bg-[#F4F6F9]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[55vh] overflow-auto bg-[#F4F6F9] p-4 text-center">
              {verifyOrder.payment_proof_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={verifyOrder.payment_proof_url}
                  alt="Bukti Transfer"
                  className="mx-auto max-h-[46vh] rounded-2xl border border-[#E2E8F0] bg-white object-contain"
                />
              ) : (
                <p className="py-8 text-xs text-[#5B6B7C]">Tidak ada gambar bukti.</p>
              )}
            </div>

            <div className="border-t border-[#EDF1F5] bg-white p-4">
              {showRejectBox ? (
                <div className="space-y-2.5">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Alasan penolakan (misal: nominal kurang Rp2.000)"
                    className="w-full rounded-xl border border-[#F5B7B1] bg-[#FEF2F2] px-3.5 py-2.5 text-xs outline-none"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setShowRejectBox(false)}
                      className="rounded-full border border-[#D7E0E8] py-2.5 text-xs font-bold text-[#071E33]"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={busyId === `reject-${verifyOrder.id}`}
                      onClick={() => rejectOrderProof(verifyOrder.id)}
                      className="rounded-full bg-[#C81E1E] py-2.5 text-xs font-bold text-white"
                    >
                      Tolak Bukti
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRejectBox(true)}
                    className="rounded-full border border-[#F5B7B1] bg-[#FEF2F2] py-3 text-xs font-bold text-[#C81E1E]"
                  >
                    Tolak
                  </button>
                  <button
                    type="button"
                    disabled={busyId === `paid-${verifyOrder.id}`}
                    onClick={() => confirmOrderPaid(verifyOrder.id)}
                    className="rounded-full bg-[#16884A] py-3 text-xs font-bold text-white"
                  >
                    Konfirmasi Lunas
                  </button>
                </div>
              )}
            </div>
          </div>
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
