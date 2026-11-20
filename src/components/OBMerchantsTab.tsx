"use client";

import { useState } from "react";
import { formatRupiah } from "@/lib/format";
import type { Merchant } from "@/lib/types";

interface OBMerchantsTabProps {
  merchants: Merchant[];
  canDelete?: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function OBMerchantsTab({
  merchants,
  canDelete = false,
  onRefresh,
  onNotify,
}: OBMerchantsTabProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<
    "Makanan" | "Minuman" | "Minimarket" | "Lainnya"
  >("Makanan");
  const [locationNote, setLocationNote] = useState("");
  const [addingMerchant, setAddingMerchant] = useState(false);

  const [addingMenuToId, setAddingMenuToId] = useState<number | null>(null);
  const [menuName, setMenuName] = useState("");
  const [menuPrice, setMenuPrice] = useState("");

  async function handleAddMerchant(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setAddingMerchant(true);
    try {
      const res = await fetch("/api/merchants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          location_note: locationNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal menambah warung.", "error");
        return;
      }
      setName("");
      setLocationNote("");
      await onRefresh();
      onNotify("Warung langganan ditambahkan.", "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setAddingMerchant(false);
    }
  }

  async function handleDeleteMerchant(merchant: Merchant) {
    if (!confirm(`Hapus ${merchant.name} dari daftar warung langganan?`)) return;
    try {
      const res = await fetch(`/api/merchants/${merchant.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        onNotify(data.error || "Gagal menghapus warung.", "error");
        return;
      }
      await onRefresh();
      onNotify(`${merchant.name} dihapus dari daftar.`, "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    }
  }

  async function handleAddMenu(merchantId: number) {
    if (!menuName.trim()) return;
    const price = parseInt(menuPrice.replace(/\D/g, "") || "0", 10);
    try {
      const res = await fetch(`/api/merchants/${merchantId}/menus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: menuName.trim(), estimated_price: price }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal menambah menu.", "error");
        return;
      }
      setMenuName("");
      setMenuPrice("");
      setAddingMenuToId(null);
      await onRefresh();
      onNotify("Menu ditambahkan.", "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    }
  }

  return (
    <div className="bg-white pb-8">
      <div className="bg-[#071E33] px-4 pb-5 pt-4 text-white">
        <h2 className="text-lg font-extrabold">Daftar Warung</h2>
        <p className="mt-0.5 text-xs text-[#AFC6DC]">
          Kelola warung langganan dan menu favorit kantor.
        </p>
      </div>

      {/* Add Merchant Form */}
      <form onSubmit={handleAddMerchant} className="space-y-2.5 px-4 py-4">
        <p className="text-xs font-extrabold text-[#071E33]">
          Tambah Warung Baru
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nama warung (misal: Soto Betawi Bang Jali)"
          required
          className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-xs outline-none focus:border-[#071E33] focus:bg-white"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={category}
            onChange={(e) =>
              setCategory(
                e.target.value as "Makanan" | "Minuman" | "Minimarket" | "Lainnya"
              )
            }
            className="rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3 py-2.5 text-xs outline-none focus:border-[#071E33] focus:bg-white"
          >
            <option value="Makanan">Makanan</option>
            <option value="Minuman">Minuman</option>
            <option value="Minimarket">Minimarket</option>
            <option value="Lainnya">Lainnya</option>
          </select>
          <input
            type="text"
            value={locationNote}
            onChange={(e) => setLocationNote(e.target.value)}
            placeholder="Lokasi singkat"
            className="rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-xs outline-none focus:border-[#071E33] focus:bg-white"
          />
        </div>
        <button
          type="submit"
          disabled={addingMerchant}
          className="w-full rounded-full bg-[#E8472E] py-2.5 text-xs font-bold text-white hover:bg-[#D13B24] disabled:opacity-60"
        >
          {addingMerchant ? "Menyimpan..." : "Simpan Warung"}
        </button>
      </form>

      <div className="h-2 bg-[#F4F6F9]" />

      {/* Existing Merchants */}
      <div className="divide-y divide-[#EDF1F5] px-4">
        {merchants.map((m) => (
          <div key={m.id} className="py-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-extrabold text-[#071E33]">{m.name}</h4>
                <p className="text-xs text-[#5B6B7C]">
                  {m.category}
                  {m.location_note ? ` · ${m.location_note}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {m.default_qris_image && (
                  <span className="rounded-md bg-[#ECFDF3] px-2 py-0.5 text-[10px] font-bold text-[#16884A]">
                    QRIS Tersimpan
                  </span>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDeleteMerchant(m)}
                    className="text-[11px] font-bold text-[#C81E1E]"
                  >
                    Hapus
                  </button>
                )}
              </div>
            </div>

            <ul className="mt-2.5 space-y-1 text-xs text-[#334155]">
              {m.menu_items.length === 0 ? (
                <li className="text-[#94A3B8]">Belum ada daftar menu.</li>
              ) : (
                m.menu_items.map((it) => (
                  <li key={it.id} className="flex justify-between">
                    <span>{it.name}</span>
                    <span className="font-bold tabular-nums text-[#071E33]">
                      {formatRupiah(it.estimated_price)}
                    </span>
                  </li>
                ))
              )}
            </ul>

            {addingMenuToId === m.id ? (
              <div className="mt-3 space-y-2 rounded-2xl bg-[#F8FAFC] p-3">
                <input
                  type="text"
                  value={menuName}
                  onChange={(e) => setMenuName(e.target.value)}
                  placeholder="Nama menu baru"
                  className="w-full rounded-xl border border-[#D7E0E8] bg-white px-3 py-2 text-xs outline-none"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={menuPrice}
                    onChange={(e) => setMenuPrice(e.target.value.replace(/\D/g, ""))}
                    placeholder="Estimasi Rp"
                    className="flex-1 rounded-xl border border-[#D7E0E8] bg-white px-3 py-2 text-xs outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddMenu(m.id)}
                    className="rounded-full bg-[#071E33] px-4 py-2 text-xs font-bold text-white"
                  >
                    Simpan
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingMenuToId(null)}
                    className="rounded-full px-3 py-2 text-xs font-bold text-[#5B6B7C]"
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddingMenuToId(m.id);
                  setMenuName("");
                  setMenuPrice("");
                }}
                className="mt-2.5 text-xs font-bold text-[#E8472E]"
              >
                + Tambah menu
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
