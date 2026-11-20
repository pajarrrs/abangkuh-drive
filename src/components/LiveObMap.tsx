"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type L from "leaflet";
import type { ObLocationInfo, ObLocationStatus } from "@/lib/types";

const FALLBACK_CENTER: [number, number] = [-6.2088, 106.8456];

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatObStatusText(
  status: ObLocationStatus,
  merchantName: string
): string {
  if (status === "AT_MERCHANT") {
    return merchantName ? `Di ${merchantName}` : "Sedang di warung";
  }
  if (status === "RETURNING") return "Balik ke kantor";
  if (status === "ON_THE_WAY") {
    return merchantName ? `Menuju ${merchantName}` : "Sedang di jalan";
  }
  return "Lokasi belum aktif";
}

export function formatUpdatedAgo(sqliteUtc: string | null): string {
  if (!sqliteUtc) return "";
  const iso = sqliteUtc.includes("T") ? sqliteUtc : `${sqliteUtc.replace(" ", "T")}Z`;
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (Number.isNaN(diffSec)) return "";
  if (diffSec < 15) return "Baru saja";
  if (diffSec < 60) return `${diffSec} dtk lalu`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} mnt lalu`;
  return `${Math.floor(mins / 60)} jam lalu`;
}

interface LiveObMapProps {
  locations: ObLocationInfo[];
  heightClass?: string;
}

export function LiveObMap({
  locations,
  heightClass = "h-56",
}: LiveObMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const hasFittedObRef = useRef(false);
  const hasCenteredDeviceRef = useRef(false);

  const [deviceCoord, setDeviceCoord] = useState<[number, number] | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const activePins = useMemo(
    () =>
      locations.filter(
        (l) => l.is_sharing === 1 && l.lat !== null && l.lng !== null
      ),
    [locations]
  );

  // Follow device location automatically so map opens at user's real location
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setDeviceCoord([pos.coords.latitude, pos.coords.longitude]);
      },
      () => {
        // Silently keep fallback center if user declines device geolocation
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // Initialize read-only Leaflet map once
  useEffect(() => {
    let cancelled = false;

    async function initMap() {
      const leaflet = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      leafletRef.current = leaflet;
      const container = containerRef.current as HTMLDivElement & {
        _leaflet_id?: number;
      };
      if (container._leaflet_id) {
        container._leaflet_id = undefined;
      }

      const initialCenter: [number, number] =
        activePins[0]?.lat != null && activePins[0]?.lng != null
          ? [activePins[0].lat, activePins[0].lng]
          : deviceCoord ?? FALLBACK_CENTER;

      const map = leaflet.map(container, {
        center: initialCenter,
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
      });

      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap",
        })
        .addTo(map);

      markersLayerRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);

      setTimeout(() => {
        if (!cancelled && mapRef.current) {
          mapRef.current.invalidateSize();
        }
      }, 150);
    }

    initMap();

    return () => {
      cancelled = true;
      setMapReady(false);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersLayerRef.current = null;
        hasFittedObRef.current = false;
        hasCenteredDeviceRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render live OB markers + current device location dot (read-only)
  useEffect(() => {
    if (!mapReady) return;
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!leaflet || !map || !layer) return;

    layer.clearLayers();

    const bounds: [number, number][] = [];

    if (deviceCoord) {
      bounds.push(deviceCoord);
      const meIcon = leaflet.divIcon({
        className: "",
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: `<div style="width:16px;height:16px;border-radius:9999px;background:#2563EB;border:3px solid #ffffff;box-shadow:0 0 0 6px rgba(37,99,235,0.22);"></div>`,
      });
      leaflet.marker(deviceCoord, { icon: meIcon }).addTo(layer);
    }

    activePins.forEach((ob, idx) => {
      if (ob.lat === null || ob.lng === null) return;
      const pos: [number, number] = [ob.lat, ob.lng];
      bounds.push(pos);

      const bg = idx % 2 === 0 ? "#E8472E" : "#071E33";
      const shortName = escapeHtml(ob.ob_name.replace(/\s*\(.*?\)\s*/g, "").trim());
      const statusSub = escapeHtml(
        formatObStatusText(ob.status_label, ob.current_merchant_name)
      );

      const icon = leaflet.divIcon({
        className: "",
        iconSize: [140, 48],
        iconAnchor: [70, 44],
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="background:${bg};color:#ffffff;padding:4px 10px;border-radius:9999px;font-family:var(--font-jakarta),sans-serif;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 4px 12px rgba(7,30,51,0.28);border:2px solid #ffffff;">
              ${shortName}
            </div>
            <div style="margin-top:2px;background:#ffffff;color:#071E33;padding:1px 7px;border-radius:9999px;font-family:var(--font-jakarta),sans-serif;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(7,30,51,0.18);">
              ${statusSub}
            </div>
            <div style="margin-top:2px;width:10px;height:10px;border-radius:9999px;background:${bg};border:2px solid #ffffff;box-shadow:0 0 0 4px rgba(232,71,46,0.22);"></div>
          </div>
        `,
      });

      leaflet.marker(pos, { icon }).addTo(layer);
    });

    if (activePins.length > 0 && !hasFittedObRef.current) {
      hasFittedObRef.current = true;
      if (bounds.length === 1) {
        map.setView(bounds[0], 16);
      } else {
        map.fitBounds(bounds, { padding: [44, 44], maxZoom: 16 });
      }
    } else if (activePins.length === 0 && deviceCoord && !hasCenteredDeviceRef.current) {
      hasCenteredDeviceRef.current = true;
      map.setView(deviceCoord, 16);
    }
  }, [mapReady, activePins, deviceCoord]);

  function handleRecenter() {
    const map = mapRef.current;
    if (!map) return;

    const points: [number, number][] = activePins
      .filter((p) => p.lat !== null && p.lng !== null)
      .map((p) => [p.lat!, p.lng!]);

    if (deviceCoord) points.push(deviceCoord);

    if (points.length === 1) {
      map.setView(points[0], 16);
    } else if (points.length > 1) {
      map.fitBounds(points, { padding: [44, 44], maxZoom: 16 });
    }
  }

  return (
    <div className="relative isolate z-0 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#EEF4F9]">
      <div ref={containerRef} className={`w-full ${heightClass} z-0`} />

      {(activePins.length > 0 || deviceCoord) && (
        <button
          type="button"
          onClick={handleRecenter}
          className="absolute right-2.5 top-2.5 z-[400] rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-[#071E33] shadow-sm ring-1 ring-[#E2E8F0] hover:bg-white"
        >
          Pusatkan
        </button>
      )}

      {activePins.length === 0 && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[400] flex justify-center">
          <div className="rounded-xl bg-[#071E33]/90 px-3.5 py-2 text-center shadow-md backdrop-blur-xs">
            <p className="text-[11px] font-bold text-white">
              Driver belum menyalakan GPS · Menampilkan lokasi perangkatmu
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
