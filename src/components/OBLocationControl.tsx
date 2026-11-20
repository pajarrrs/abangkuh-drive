"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MerchantBatch,
  ObLocationInfo,
  ObLocationStatus,
  UserProfile,
} from "@/lib/types";
import { formatObStatusText, formatUpdatedAgo } from "./LiveObMap";

interface OBLocationControlProps {
  currentUser: UserProfile;
  myLocation: ObLocationInfo | null;
  myBatches: MerchantBatch[];
  onUpdated: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function OBLocationControl({
  myLocation,
  myBatches,
  onUpdated,
  onNotify,
}: OBLocationControlProps) {
  const [isGpsWatching, setIsGpsWatching] = useState(false);
  const [statusLabel, setStatusLabel] = useState<ObLocationStatus>(
    myLocation?.is_sharing ? myLocation.status_label : "ON_THE_WAY"
  );
  const [selectedMerchant, setSelectedMerchant] = useState(
    myLocation?.current_merchant_name || myBatches[0]?.merchant_name || ""
  );
  const [saving, setSaving] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const lastSentAtRef = useRef<number>(0);
  const latestMetaRef = useRef({
    statusLabel,
    selectedMerchant,
  });

  useEffect(() => {
    latestMetaRef.current = { statusLabel, selectedMerchant };
  }, [statusLabel, selectedMerchant]);

  const pushLocation = useCallback(
    async (
      lat: number,
      lng: number,
      accuracy: number,
      isSharing: boolean,
      status: ObLocationStatus,
      merchantName: string
    ) => {
      const res = await fetch("/api/ob-locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat,
          lng,
          accuracy,
          current_merchant_name: merchantName,
          status_label: status,
          is_sharing: isSharing,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Gagal update lokasi GPS.");
      }
      await onUpdated();
    },
    [onUpdated]
  );

  const startWatchLoop = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (update) => {
        const now = Date.now();
        if (now - lastSentAtRef.current < 8000) return;
        lastSentAtRef.current = now;
        pushLocation(
          update.coords.latitude,
          update.coords.longitude,
          update.coords.accuracy,
          true,
          latestMetaRef.current.statusLabel,
          latestMetaRef.current.selectedMerchant
        ).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    setIsGpsWatching(true);
  }, [pushLocation]);

  // Resume GPS watcher automatically if OB already had sharing turned on before page reload
  useEffect(() => {
    if (myLocation?.is_sharing === 1 && watchIdRef.current === null) {
      startWatchLoop();
    }
  }, [myLocation?.is_sharing, startWatchLoop]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== "undefined") {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  function startGpsSharing() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      onNotify("Perangkat ini tidak mendukung GPS browser.", "error");
      return;
    }

    setSaving(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          lastSentAtRef.current = Date.now();
          await pushLocation(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy,
            true,
            latestMetaRef.current.statusLabel,
            latestMetaRef.current.selectedMerchant
          );
          startWatchLoop();
          onNotify("GPS live aktif. Posisi perangkatmu tampil di peta karyawan.", "success");
        } catch (err) {
          onNotify(
            err instanceof Error ? err.message : "Gagal mengaktifkan GPS.",
            "error"
          );
        } finally {
          setSaving(false);
        }
      },
      (geoErr) => {
        setSaving(false);
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          onNotify(
            "Izin lokasi ditolak. Aktifkan izin GPS di browser/HP agar lokasi tampil di peta.",
            "error"
          );
        } else {
          onNotify(
            "GPS perangkat tidak merespons. Pastikan layanan lokasi (GPS) HP menyala.",
            "error"
          );
        }
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  async function stopSharing() {
    if (watchIdRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsGpsWatching(false);
    setSaving(true);
    try {
      const res = await fetch("/api/ob-locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_sharing: false }),
      });
      if (!res.ok) throw new Error();
      await onUpdated();
      onNotify("Live GPS dimatikan.", "success");
    } catch {
      onNotify("Gagal mematikan live GPS.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function updateQuickStatus(nextStatus: ObLocationStatus, nextMerchant?: string) {
    const merchantVal = nextMerchant !== undefined ? nextMerchant : selectedMerchant;
    setStatusLabel(nextStatus);
    if (nextMerchant !== undefined) setSelectedMerchant(nextMerchant);

    if (
      myLocation?.is_sharing === 1 &&
      myLocation.lat !== null &&
      myLocation.lng !== null
    ) {
      try {
        await pushLocation(
          myLocation.lat,
          myLocation.lng,
          myLocation.accuracy ?? 20,
          true,
          nextStatus,
          merchantVal
        );
      } catch {
        onNotify("Gagal memperbarui status.", "error");
      }
    }
  }

  const isLive = myLocation?.is_sharing === 1;

  return (
    <div className="border-b border-[#EDF1F5] bg-[#F8FAFC] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                isLive ? "animate-pulse bg-[#E8472E]" : "bg-[#94A3B8]"
              }`}
            />
            <p className="text-xs font-extrabold text-[#071E33]">
              {isLive
                ? `GPS Live Aktif${isGpsWatching ? "" : " · Menyambung"}`
                : "Live GPS Perangkat"}
            </p>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-[#5B6B7C]">
            {isLive
              ? `${formatObStatusText(
                  myLocation.status_label,
                  myLocation.current_merchant_name
                )}${
                  myLocation.updated_at
                    ? ` · ${formatUpdatedAgo(myLocation.updated_at)}`
                    : ""
                }`
              : "Otomatis mengikuti GPS HP saat kamu belanja"}
          </p>
        </div>

        <div className="shrink-0">
          {isLive ? (
            <button
              type="button"
              disabled={saving}
              onClick={stopSharing}
              className="rounded-full bg-[#071E33] px-4 py-1.5 text-[11px] font-bold text-white"
            >
              Matikan GPS
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={startGpsSharing}
              className="rounded-full bg-[#E8472E] px-4 py-1.5 text-[11px] font-bold text-white hover:bg-[#D13B24]"
            >
              {saving ? "Mencari GPS..." : "Aktifkan GPS"}
            </button>
          )}
        </div>
      </div>

      {isLive && (
        <div className="mt-2.5 space-y-2">
          <div className="flex gap-1.5">
            {(
              [
                { key: "ON_THE_WAY", label: "Di Jalan" },
                { key: "AT_MERCHANT", label: "Di Warung" },
                { key: "RETURNING", label: "Balik Kantor" },
              ] as Array<{ key: ObLocationStatus; label: string }>
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => updateQuickStatus(opt.key)}
                className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                  statusLabel === opt.key
                    ? "bg-[#071E33] text-white"
                    : "bg-white text-[#5B6B7C] ring-1 ring-[#E2E8F0]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {myBatches.length > 0 && statusLabel !== "RETURNING" && (
            <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
              <span className="shrink-0 text-[11px] font-semibold text-[#6B7C8F]">
                Warung:
              </span>
              {myBatches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => updateQuickStatus(statusLabel, b.merchant_name)}
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    selectedMerchant === b.merchant_name
                      ? "bg-[#FFF1EE] text-[#E8472E] ring-1 ring-[#FFD4CC]"
                      : "bg-white text-[#5B6B7C] ring-1 ring-[#E2E8F0]"
                  }`}
                >
                  {b.merchant_name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
