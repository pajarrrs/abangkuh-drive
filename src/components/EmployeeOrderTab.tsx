"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import { formatRupiah } from "@/lib/format";
import { getSessionTimeState } from "@/lib/notifications";
import type {
  Merchant,
  ObLocationInfo,
  OrderRecord,
  OrderSession,
  PaymentMethod,
  UserProfile,
} from "@/lib/types";
import { formatObStatusText } from "./LiveObMap";

interface EmployeeOrderTabProps {
  currentUser: UserProfile;
  sessions: OrderSession[];
  selectedSessionId: number | null;
  onSelectSession: (id: number) => void;
  currentTimeWib: string;
  merchants: Merchant[];
  myOrders: OrderRecord[];
  obLocations: ObLocationInfo[];
  onOrderCreated: () => Promise<void>;
  onGoToPayments: () => void;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

interface DraftItem {
  key: string;
  menu_item_id: number | null;
  item_name: string;
  qty: number;
  unit_price: number;
  item_note: string;
}

const TILE_PALETTES = [
  "bg-[#071E33] text-white",
  "bg-[#E8472E] text-white",
  "bg-[#163A59] text-white",
  "bg-[#2B4E70] text-white",
  "bg-[#B8321F] text-white",
];

function getInitials(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function EmployeeOrderTab({
  currentUser,
  sessions,
  selectedSessionId,
  onSelectSession,
  currentTimeWib,
  merchants,
  myOrders,
  obLocations,
  onOrderCreated,
  onGoToPayments,
  onNotify,
}: EmployeeOrderTabProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("Semua");

  const [activeMerchant, setActiveMerchant] = useState<Merchant | null>(null);
  const [freeTextOpen, setFreeTextOpen] = useState(false);

  const [customMerchantName, setCustomMerchantName] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [extraItemName, setExtraItemName] = useState("");
  const [extraItemPrice, setExtraItemPrice] = useState("");
  const [extraItemNote, setExtraItemNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("QRIS");
  const [maxBudget, setMaxBudget] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId]
  );

  const waitingOrders = useMemo(
    () => myOrders.filter((o) => o.payment_status === "WAITING_PAYMENT"),
    [myOrders]
  );

  const liveObs = useMemo(
    () => obLocations.filter((l) => l.is_sharing === 1),
    [obLocations]
  );

  const filteredMerchants = useMemo(() => {
    const q = search.trim().toLowerCase();
    return merchants.filter((m) => {
      if (category !== "Semua" && m.category !== category) return false;
      if (!q) return true;
      if (m.name.toLowerCase().includes(q)) return true;
      return m.menu_items.some((item) => item.name.toLowerCase().includes(q));
    });
  }, [merchants, search, category]);

  function openMerchantSheet(merchant: Merchant) {
    if (!selectedSession?.can_order) {
      onNotify("Sesi ini sudah ditutup Driver. Pilih sesi lain yang masih buka.", "error");
      return;
    }
    setActiveMerchant(merchant);
    setFreeTextOpen(false);
    setDraftItems([]);
    setExtraItemName("");
    setExtraItemPrice("");
    setExtraItemNote("");
    setPaymentMethod("QRIS");
    setMaxBudget("");
    setOrderNotes("");
  }

  function openFreeTextSheet() {
    if (!selectedSession?.can_order) {
      onNotify("Sesi ini sudah ditutup Driver. Pilih sesi lain yang masih buka.", "error");
      return;
    }
    setActiveMerchant(null);
    setFreeTextOpen(true);
    setCustomMerchantName("");
    setDraftItems([]);
    setExtraItemName("");
    setExtraItemPrice("");
    setExtraItemNote("");
    setPaymentMethod("QRIS");
    setMaxBudget("");
    setOrderNotes("");
  }

  function closeSheet() {
    setActiveMerchant(null);
    setFreeTextOpen(false);
  }

  function adjustCatalogQty(menuId: number, name: string, price: number, delta: number) {
    const key = `menu-${menuId}`;
    setDraftItems((prev) => {
      const idx = prev.findIndex((i) => i.key === key);
      if (idx === -1) {
        if (delta <= 0) return prev;
        return [
          ...prev,
          {
            key,
            menu_item_id: menuId,
            item_name: name,
            qty: delta,
            unit_price: price,
            item_note: "",
          },
        ];
      }
      const nextQty = prev[idx].qty + delta;
      if (nextQty <= 0) return prev.filter((i) => i.key !== key);
      const copy = [...prev];
      copy[idx] = { ...copy[idx], qty: nextQty };
      return copy;
    });
  }

  function addCustomItemToDraft() {
    const name = extraItemName.trim();
    if (!name) return;
    const parsedPrice = Math.max(0, parseInt(extraItemPrice.replace(/\D/g, "") || "0", 10));
    setDraftItems((prev) => [
      ...prev,
      {
        key: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        menu_item_id: null,
        item_name: name,
        qty: 1,
        unit_price: parsedPrice,
        item_note: extraItemNote.trim(),
      },
    ]);
    setExtraItemName("");
    setExtraItemPrice("");
    setExtraItemNote("");
  }

  function updateDraftItemNote(key: string, note: string) {
    setDraftItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, item_note: note } : item))
    );
  }

  function removeDraftItem(key: string) {
    setDraftItems((prev) => prev.filter((item) => item.key !== key));
  }

  const totalItemCount = useMemo(
    () => draftItems.reduce((sum, i) => sum + i.qty, 0),
    [draftItems]
  );

  const draftTotal = useMemo(
    () => draftItems.reduce((sum, i) => sum + i.qty * i.unit_price, 0),
    [draftItems]
  );

  async function handleSubmitOrder() {
    if (!selectedSession) return;

    let itemsToSubmit = [...draftItems];
    if (extraItemName.trim()) {
      const parsedPrice = Math.max(0, parseInt(extraItemPrice.replace(/\D/g, "") || "0", 10));
      itemsToSubmit = [
        ...itemsToSubmit,
        {
          key: "inline",
          menu_item_id: null,
          item_name: extraItemName.trim(),
          qty: 1,
          unit_price: parsedPrice,
          item_note: extraItemNote.trim(),
        },
      ];
    }

    const merchantName = activeMerchant
      ? activeMerchant.name
      : customMerchantName.trim();

    if (merchantName.length < 2) {
      onNotify("Isi nama warung atau toko dulu.", "error");
      return;
    }
    if (itemsToSubmit.length === 0) {
      onNotify("Pilih atau ketik minimal 1 item.", "error");
      return;
    }

    setSubmitting(true);
    try {
      const parsedBudget = parseInt(maxBudget.replace(/\D/g, "") || "0", 10);
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: selectedSession.id,
          merchant_id: activeMerchant?.id ?? null,
          merchant_name: merchantName,
          payment_method: paymentMethod,
          max_budget: parsedBudget > 0 ? parsedBudget : null,
          notes: orderNotes.trim(),
          items: itemsToSubmit.map((i) => ({
            menu_item_id: i.menu_item_id,
            item_name: i.item_name,
            qty: i.qty,
            unit_price: i.unit_price,
            item_note: i.item_note,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal mengirim pesanan.", "error");
        return;
      }

      closeSheet();
      if (
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        Notification.requestPermission().catch(() => {});
      }
      await onOrderCreated();
      onNotify(`Pesanan ke ${merchantName} terkirim ke Driver.`, "success");
    } catch {
      onNotify("Gagal terhubung ke server.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white pb-6">
      {/* GoFood/Grab-style Deep Alturian Navy Top Banner + Overlapping Search */}
      <div className="bg-[#071E33] px-4 pb-8 pt-3 text-white">
        <div className="flex items-center justify-between text-xs">
          <div>
            <p className="text-[11px] text-[#AFC6DC]">Halo,</p>
            <p className="font-bold text-white">{currentUser.name}</p>
          </div>
          <span className="rounded-full bg-[#102D47] px-3 py-1 text-[11px] font-semibold tabular-nums text-[#AFC6DC]">
            {currentTimeWib} WIB
          </span>
        </div>

        {/* Clean Segmented Session Switcher */}
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          {sessions.map((s) => {
            const active = s.id === selectedSession?.id;
            const timeState = getSessionTimeState(s.open_time, s.close_time);
            const isPastWhileOpen = s.status === "OPEN" && timeState === "PAST";
            const dotColor =
              s.status === "OPEN"
                ? isPastWhileOpen
                  ? "bg-[#F59E0B]"
                  : "bg-[#22C55E]"
                : s.status === "SHOPPING"
                ? "bg-[#FE583E]"
                : "bg-[#94A3B8]";
            const statusLabel =
              s.status === "OPEN"
                ? isPastWhileOpen
                  ? "Lewat Jam"
                  : timeState === "ACTIVE" || timeState === "CLOSING_SOON"
                  ? "Berlangsung"
                  : "Buka"
                : s.status === "SHOPPING"
                ? "Driver Belanja"
                : "Selesai";

            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSession(s.id)}
                className={`rounded-2xl px-3 py-2.5 text-left transition ${
                  active
                    ? "bg-white text-[#071E33] shadow-sm"
                    : "bg-[#102D47] text-white/80 hover:bg-[#163A59]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold">
                    Sesi {s.slot === "SIANG" ? "Siang" : "Sore"}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold">
                    <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                    {statusLabel}
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
      </div>

      {/* Overlapping Pill Search Bar */}
      <div className="-mt-5 px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-[#6B7C8F]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mau titip makan atau barang apa?"
            className="w-full rounded-full border border-[#E2E8F0] bg-white py-3 pl-11 pr-4 text-sm text-[#071E33] shadow-md shadow-[#071E33]/8 outline-none placeholder:text-[#8A99A8] focus:border-[#071E33]"
          />
        </div>
      </div>

      {/* Active OB Live Location Strip */}
      {liveObs.length > 0 && (
        <div className="px-4 pt-3.5">
          <button
            type="button"
            onClick={onGoToPayments}
            className="flex w-full items-center justify-between gap-3 rounded-2xl bg-[#071E33] px-4 py-3 text-left text-white transition active:scale-[0.99]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#FE583E]" />
                <p className="text-[11px] font-bold text-[#AFC6DC]">
                  Live Lokasi Driver ({liveObs.length} aktif)
                </p>
              </div>
              <p className="mt-0.5 truncate text-xs font-extrabold">
                {liveObs[0].ob_name} ·{" "}
                {formatObStatusText(
                  liveObs[0].status_label,
                  liveObs[0].current_merchant_name
                )}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-[11px] font-extrabold text-[#071E33]">
              Lihat Peta
            </span>
          </button>
        </div>
      )}

      {/* Active QRIS Alert Strip (Compact Gojek Live Pill) */}
      {waitingOrders.length > 0 && (
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={onGoToPayments}
            className="flex w-full items-center justify-between rounded-2xl bg-[#FFF1EE] px-4 py-3 text-left ring-1 ring-[#FFD4CC] transition active:scale-[0.99]"
          >
            <div className="min-w-0 pr-3">
              <p className="text-xs font-extrabold text-[#C7331D]">
                {waitingOrders.length} QRIS pedagang siap dibayar
              </p>
              <p className="truncate text-[11px] text-[#5B6B7C]">
                {waitingOrders[0].merchant_name} ·{" "}
                {formatRupiah(waitingOrders[0].effective_total)}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-[#E8472E] px-4 py-1.5 text-xs font-bold text-white">
              Bayar
            </span>
          </button>
        </div>
      )}

      {/* Clean Free-Text Entry Strip */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E6EBF0] bg-[#F8FAFC] px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#071E33]">
              Titip warung lain atau barang?
            </p>
            <p className="text-xs text-[#5B6B7C]">
              Ketik nama toko, gorengan, apotek, atau titipan bebas
            </p>
          </div>
          <button
            type="button"
            onClick={openFreeTextSheet}
            disabled={!selectedSession?.can_order}
            className="shrink-0 rounded-full bg-[#071E33] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#102D47] disabled:opacity-40"
          >
            Titip Bebas
          </button>
        </div>
      </div>

      {/* Horizontal Category Chips */}
      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {["Semua", "Makanan", "Minuman", "Minimarket", "Lainnya"].map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition ${
              category === cat
                ? "bg-[#071E33] text-white"
                : "bg-[#F4F6F9] text-[#475569] hover:bg-[#E8EEF4]"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Section Divider */}
      <div className="mt-4 h-2 bg-[#F4F6F9]" />

      {/* Merchant Feed (Clean GoFood Row Style) */}
      <div className="px-4 pt-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-extrabold text-[#071E33]">
            Warung Langganan
          </h2>
          <span className="text-xs font-medium text-[#6B7C8F]">
            {filteredMerchants.length} tempat
          </span>
        </div>

        {filteredMerchants.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#5B6B7C]">
            Tidak ketemu. Pakai tombol{" "}
            <button
              type="button"
              onClick={openFreeTextSheet}
              className="font-bold text-[#E8472E] underline"
            >
              Titip Bebas
            </button>{" "}
            di atas.
          </div>
        ) : (
          <div className="divide-y divide-[#EDF1F5]">
            {filteredMerchants.map((m, idx) => {
              const minPrice =
                m.menu_items.length > 0
                  ? Math.min(...m.menu_items.map((it) => it.estimated_price))
                  : null;
              const palette = TILE_PALETTES[idx % TILE_PALETTES.length];

              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => openMerchantSheet(m)}
                  className="flex w-full items-start gap-3.5 py-4 text-left transition active:bg-[#F8FAFC]"
                >
                  <div
                    className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold tracking-tight ${palette}`}
                  >
                    {getInitials(m.name)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate text-[15px] font-bold text-[#071E33]">
                        {m.name}
                      </h3>
                      {m.default_qris_image && (
                        <span className="shrink-0 rounded-md bg-[#ECFDF3] px-1.5 py-0.5 text-[10px] font-bold text-[#16884A]">
                          QRIS Siap
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 truncate text-xs text-[#5B6B7C]">
                      {m.category}
                      {m.location_note ? ` · ${m.location_note}` : ""}
                    </p>

                    {m.menu_items.length > 0 && (
                      <p className="mt-1.5 line-clamp-1 text-xs text-[#7C8B9B]">
                        {m.menu_items.map((it) => it.name).join(", ")}
                      </p>
                    )}

                    {minPrice !== null && (
                      <p className="mt-1.5 text-xs font-bold tabular-nums text-[#071E33]">
                        Mulai {formatRupiah(minPrice)}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* GoFood-Style Bottom Sheet for Ordering */}
      {(activeMerchant || freeTextOpen) && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-[#071E33]/65 sm:items-center sm:p-4"
          onClick={closeSheet}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-[#EDF1F5] px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-[#E8472E]">
                  {selectedSession?.label}
                </p>
                <h3 className="truncate text-base font-extrabold text-[#071E33]">
                  {activeMerchant ? activeMerchant.name : "Titip Bebas"}
                </h3>
                {activeMerchant?.location_note && (
                  <p className="text-xs text-[#5B6B7C]">
                    {activeMerchant.location_note}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={closeSheet}
                className="rounded-full p-1.5 text-[#5B6B7C] hover:bg-[#F4F6F9]"
                aria-label="Tutup"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {freeTextOpen && (
                <div className="mb-5">
                  <label className="mb-1.5 block text-xs font-bold text-[#071E33]">
                    Nama Warung / Toko *
                  </label>
                  <input
                    type="text"
                    value={customMerchantName}
                    onChange={(e) => setCustomMerchantName(e.target.value)}
                    placeholder="Contoh: Bakmi GM, Apotek K24, Gorengan Depan"
                    className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-sm text-[#071E33] outline-none focus:border-[#071E33] focus:bg-white"
                  />
                  <p className="mt-1 text-[11px] text-[#6B7C8F]">
                    Nama warung yang sama otomatis digabung jadi 1 antrean Driver.
                  </p>
                </div>
              )}

              {/* Catalog Menu Rows */}
              {activeMerchant && activeMerchant.menu_items.length > 0 && (
                <div className="mb-5">
                  <p className="mb-1 text-xs font-extrabold text-[#071E33]">
                    Menu Populer
                  </p>
                  <div className="divide-y divide-[#EDF1F5]">
                    {activeMerchant.menu_items.map((menu) => {
                      const existing = draftItems.find(
                        (i) => i.key === `menu-${menu.id}`
                      );
                      const qty = existing?.qty ?? 0;
                      return (
                        <div key={menu.id} className="py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[#071E33]">
                                {menu.name}
                              </p>
                              <p className="mt-0.5 text-xs font-bold tabular-nums text-[#5B6B7C]">
                                {formatRupiah(menu.estimated_price)}
                              </p>
                            </div>

                            {qty === 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  adjustCatalogQty(
                                    menu.id,
                                    menu.name,
                                    menu.estimated_price,
                                    1
                                  )
                                }
                                className="shrink-0 rounded-full border border-[#E8472E] px-4 py-1 text-xs font-bold text-[#E8472E] transition hover:bg-[#FFF1EE]"
                              >
                                Tambah
                              </button>
                            ) : (
                              <div className="flex shrink-0 items-center gap-2.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    adjustCatalogQty(
                                      menu.id,
                                      menu.name,
                                      menu.estimated_price,
                                      -1
                                    )
                                  }
                                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D7E0E8] text-[#071E33]"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <span className="w-4 text-center text-sm font-extrabold tabular-nums">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    adjustCatalogQty(
                                      menu.id,
                                      menu.name,
                                      menu.estimated_price,
                                      1
                                    )
                                  }
                                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E8472E] text-white"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>

                          {existing && (
                            <input
                              type="text"
                              value={existing.item_note}
                              onChange={(e) =>
                                updateDraftItemNote(existing.key, e.target.value)
                              }
                              placeholder="Catatan item (misal: sambal pisah, es dikit)"
                              className="mt-2 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs outline-none focus:border-[#071E33] focus:bg-white"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom Item Entry */}
              <div className="mb-5 rounded-2xl border border-[#E6EBF0] bg-[#F8FAFC] p-3.5">
                <p className="mb-2 text-xs font-bold text-[#071E33]">
                  {activeMerchant
                    ? "Tambah item lain di warung ini"
                    : "Daftar item titipan"}
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={extraItemName}
                    onChange={(e) => setExtraItemName(e.target.value)}
                    placeholder="Nama makanan / barang"
                    className="w-full rounded-xl border border-[#D7E0E8] bg-white px-3 py-2 text-xs outline-none focus:border-[#071E33]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={extraItemPrice}
                      onChange={(e) =>
                        setExtraItemPrice(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="Estimasi Rp (opsional)"
                      className="rounded-xl border border-[#D7E0E8] bg-white px-3 py-2 text-xs outline-none focus:border-[#071E33]"
                    />
                    <input
                      type="text"
                      value={extraItemNote}
                      onChange={(e) => setExtraItemNote(e.target.value)}
                      placeholder="Catatan"
                      className="rounded-xl border border-[#D7E0E8] bg-white px-3 py-2 text-xs outline-none focus:border-[#071E33]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addCustomItemToDraft}
                    disabled={!extraItemName.trim()}
                    className="w-full rounded-full border border-[#071E33] bg-white py-2 text-xs font-bold text-[#071E33] hover:bg-[#071E33] hover:text-white disabled:opacity-40"
                  >
                    + Masukkan Item
                  </button>
                </div>

                {draftItems.filter((i) => i.menu_item_id === null).length > 0 && (
                  <div className="mt-3 divide-y divide-[#E6EBF0] border-t border-[#E6EBF0] pt-2">
                    {draftItems
                      .filter((i) => i.menu_item_id === null)
                      .map((item) => (
                        <div
                          key={item.key}
                          className="flex items-center justify-between py-2 text-xs"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="font-bold text-[#071E33]">
                              {item.qty}x {item.item_name}
                            </p>
                            <p className="text-[#5B6B7C]">
                              {item.unit_price > 0
                                ? formatRupiah(item.unit_price)
                                : "Harga menyusul"}
                              {item.item_note ? ` · ${item.item_note}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDraftItem(item.key)}
                            className="text-xs font-bold text-[#C81E1E]"
                          >
                            Hapus
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Payment Method */}
              <div className="mb-4">
                <p className="mb-2 text-xs font-bold text-[#071E33]">
                  Metode Pembayaran
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("QRIS")}
                    className={`rounded-xl border px-3.5 py-3 text-left transition ${
                      paymentMethod === "QRIS"
                        ? "border-[#071E33] bg-[#071E33] text-white"
                        : "border-[#D7E0E8] bg-white text-[#071E33]"
                    }`}
                  >
                    <p className="text-xs font-extrabold">QRIS Pedagang</p>
                    <p
                      className={`mt-0.5 text-[11px] ${
                        paymentMethod === "QRIS" ? "text-[#AFC6DC]" : "text-[#5B6B7C]"
                      }`}
                    >
                      Scan saat Driver di warung
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("CASH")}
                    className={`rounded-xl border px-3.5 py-3 text-left transition ${
                      paymentMethod === "CASH"
                        ? "border-[#071E33] bg-[#071E33] text-white"
                        : "border-[#D7E0E8] bg-white text-[#071E33]"
                    }`}
                  >
                    <p className="text-xs font-extrabold">Cash / Tunai</p>
                    <p
                      className={`mt-0.5 text-[11px] ${
                        paymentMethod === "CASH" ? "text-[#AFC6DC]" : "text-[#5B6B7C]"
                      }`}
                    >
                      Bayar langsung ke Driver
                    </p>
                  </button>
                </div>
              </div>

              {/* Max Budget Cap (Optional) */}
              <div className="mb-4">
                <label className="mb-1 block text-xs font-bold text-[#071E33]">
                  Batas Maks. Harga (Opsional)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={maxBudget}
                  onChange={(e) => setMaxBudget(e.target.value.replace(/\D/g, ""))}
                  placeholder="Contoh: 25000 (di bawah ini Driver langsung beli)"
                  className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-xs outline-none focus:border-[#071E33] focus:bg-white"
                />
              </div>

              {/* Overall Note */}
              <div>
                <label className="mb-1 block text-xs font-bold text-[#071E33]">
                  Catatan untuk Driver (Opsional)
                </label>
                <input
                  type="text"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="Misal: kalau rendang habis ganti ayam bakar"
                  className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-xs outline-none focus:border-[#071E33] focus:bg-white"
                />
              </div>
            </div>

            {/* GoFood-Style Floating Checkout Pill */}
            <div className="border-t border-[#EDF1F5] bg-white px-5 py-3.5">
              <button
                type="button"
                onClick={handleSubmitOrder}
                disabled={submitting}
                className="flex w-full items-center justify-between rounded-full bg-[#E8472E] px-5 py-3.5 text-white shadow-md shadow-[#E8472E]/25 transition hover:bg-[#D13B24] active:scale-[0.99] disabled:opacity-60"
              >
                <div className="text-left">
                  <p className="text-[11px] font-medium text-white/85">
                    {totalItemCount > 0
                      ? `${totalItemCount} item · ${paymentMethod}`
                      : paymentMethod}
                  </p>
                  <p className="text-sm font-extrabold tabular-nums">
                    {draftTotal > 0 ? formatRupiah(draftTotal) : "Harga menyusul"}
                  </p>
                </div>
                <span className="text-sm font-extrabold">
                  {submitting ? "Mengirim..." : "Kirim Titipan"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
