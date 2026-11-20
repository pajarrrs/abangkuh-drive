"use client";

import { useMemo, useState } from "react";
import { formatRupiah } from "@/lib/format";
import type {
  MerchantBatch,
  ObLocationInfo,
  OrderSession,
  SessionStatus,
} from "@/lib/types";
import { formatObStatusText, formatUpdatedAgo, LiveObMap } from "./LiveObMap";
import { OBRecapTab } from "./OBRecapTab";

interface AdminMonitorTabProps {
  sessions: OrderSession[];
  selectedSessionId: number | null;
  onSelectSession: (id: number) => void;
  currentTimeWib: string;
  batches: MerchantBatch[];
  obLocations: ObLocationInfo[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function AdminMonitorTab({
  sessions,
  selectedSessionId,
  onSelectSession,
  currentTimeWib,
  batches,
  obLocations,
  onRefresh,
  onNotify,
}: AdminMonitorTabProps) {
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [openTime, setOpenTime] = useState("");
  const [closeTime, setCloseTime] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId]
  );

  function startEditSchedule() {
    if (!selectedSession) return;
    setOpenTime(selectedSession.open_time);
    setCloseTime(selectedSession.close_time);
    setEditingSchedule(true);
  }

  async function saveSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSession) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/sessions/${selectedSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open_time: openTime, close_time: closeTime }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal menyimpan jam sesi.", "error");
        return;
      }
      setEditingSchedule(false);
      await onRefresh();
      onNotify("Jam sesi berhasil diperbarui.", "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(status: SessionStatus) {
    if (!selectedSession) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sessions/${selectedSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        onNotify(data.error || "Gagal mengubah status sesi.", "error");
        return;
      }
      await onRefresh();
      onNotify("Status sesi diperbarui.", "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setSaving(false);
    }
  }

  const grandSummary = useMemo(() => {
    let total = 0;
    let paid = 0;
    let orders = 0;
    let pendingVerify = 0;
    for (const b of batches) {
      total += b.summary.grand_total;
      paid += b.summary.qris_paid + b.summary.cash_paid;
      orders += b.summary.order_count;
      pendingVerify += b.summary.pending_verification_count;
    }
    return { total, paid, orders, pendingVerify };
  }, [batches]);

  return (
    <div className="bg-white pb-8">
      {/* Alturian Navy Super Admin Header */}
      <div className="bg-[#071E33] px-4 pb-5 pt-3 text-white">
        <div className="flex items-center justify-between text-xs">
          <div>
            <p className="text-[11px] text-[#AFC6DC]">Super Admin</p>
            <p className="font-extrabold text-white">Kontrol Operasional Kantor</p>
          </div>
          <span className="rounded-full bg-[#102D47] px-3 py-1 text-[11px] font-semibold tabular-nums text-[#AFC6DC]">
            {currentTimeWib} WIB
          </span>
        </div>

        {/* Session Picker */}
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          {sessions.map((s) => {
            const active = s.id === selectedSession?.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onSelectSession(s.id);
                  setEditingSchedule(false);
                }}
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
                    active ? "text-[#5B6B7C]" : "text-[#AFC6DC]"
                  }`}
                >
                  {s.open_time} – {s.close_time} WIB
                </p>
              </button>
            );
          })}
        </div>

        {/* Session Status & Schedule Edit */}
        {selectedSession && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-3 gap-1 rounded-full bg-[#102D47] p-1">
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
                    disabled={saving}
                    onClick={() => updateStatus(opt.key)}
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

            {editingSchedule ? (
              <form
                onSubmit={saveSchedule}
                className="flex items-center gap-2 rounded-2xl bg-[#102D47] p-2.5 text-xs"
              >
                <input
                  type="time"
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                  required
                  className="rounded-lg bg-white px-2 py-1 font-bold text-[#071E33]"
                />
                <span className="text-[#AFC6DC]">–</span>
                <input
                  type="time"
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                  required
                  className="rounded-lg bg-white px-2 py-1 font-bold text-[#071E33]"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="ml-auto rounded-full bg-[#E8472E] px-3 py-1 font-bold text-white"
                >
                  Simpan
                </button>
                <button
                  type="button"
                  onClick={() => setEditingSchedule(false)}
                  className="px-1.5 font-semibold text-[#AFC6DC]"
                >
                  Batal
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between px-1 text-[11px] text-[#AFC6DC]">
                <span>
                  Jadwal aktif: {selectedSession.open_time} – {selectedSession.close_time} WIB
                </span>
                <button
                  type="button"
                  onClick={startEditSchedule}
                  className="font-bold text-white underline"
                >
                  Ubah Jam
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-3 divide-x divide-[#EDF1F5] border-b border-[#EDF1F5] py-3 text-center">
        <div>
          <p className="text-[11px] text-[#6B7C8F]">Order · Bukti</p>
          <p className="mt-0.5 text-sm font-extrabold tabular-nums text-[#071E33]">
            {grandSummary.orders} ·{" "}
            <span className={grandSummary.pendingVerify > 0 ? "text-[#E8472E]" : ""}>
              {grandSummary.pendingVerify}
            </span>
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#6B7C8F]">Lunas</p>
          <p className="mt-0.5 truncate px-1 text-sm font-extrabold tabular-nums text-[#16884A]">
            {formatRupiah(grandSummary.paid)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#6B7C8F]">Total Sesi</p>
          <p className="mt-0.5 truncate px-1 text-sm font-extrabold tabular-nums text-[#071E33]">
            {formatRupiah(grandSummary.total)}
          </p>
        </div>
      </div>

      {/* Live Map Section */}
      <section className="px-4 py-4">
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
              Pantau Posisi 2 Driver
            </h3>
          </div>
          <span className="text-[11px] font-semibold text-[#5B6B7C]">
            {obLocations.filter((o) => o.is_sharing === 1).length} / {obLocations.length} live
          </span>
        </div>

        <LiveObMap locations={obLocations} heightClass="h-48" />

        {obLocations.length > 0 && (
          <div className="mt-2.5 divide-y divide-[#EDF1F5]">
            {obLocations.map((ob, idx) => {
              const isLive = ob.is_sharing === 1;
              return (
                <div
                  key={ob.ob_id}
                  className="flex items-center justify-between py-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        isLive
                          ? idx % 2 === 0
                            ? "bg-[#E8472E]"
                            : "bg-[#071E33]"
                          : "bg-[#CBD5E1]"
                      }`}
                    />
                    <span className="truncate font-bold text-[#071E33]">
                      {ob.ob_name}
                    </span>
                  </div>
                  <span className="truncate pl-2 text-[11px] text-[#5B6B7C]">
                    {isLive
                      ? `${formatObStatusText(
                          ob.status_label,
                          ob.current_merchant_name
                        )}${ob.updated_at ? ` · ${formatUpdatedAgo(ob.updated_at)}` : ""}`
                      : "Offline"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="h-2 bg-[#F4F6F9]" />

      {/* Embedded Financial Recap & Unpaid List */}
      <OBRecapTab selectedSession={selectedSession} batches={batches} />
    </div>
  );
}
