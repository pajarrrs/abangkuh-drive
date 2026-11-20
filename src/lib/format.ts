import type { SessionSlot } from "./types";

export function formatRupiah(amount: number): string {
  const safeInt = Number.isFinite(amount) ? Math.round(amount) : 0;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(safeInt);
}

export function getJakartaNow(): {
  date: string;
  time: string;
  hour: number;
  minute: number;
  totalMinutes: number;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = Number(map.hour === "24" ? "0" : map.hour);
  const minute = Number(map.minute);

  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  };
}

export function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isWithinSessionSchedule(openTime: string, closeTime: string): boolean {
  const now = getJakartaNow();
  const start = parseTimeToMinutes(openTime);
  const end = parseTimeToMinutes(closeTime);
  return now.totalMinutes >= start && now.totalMinutes <= end;
}

export function getRecommendedSlot(): SessionSlot {
  const now = getJakartaNow();
  // Before 13:00 WIB focus on Sesi Siang (10:00 - 10:30), after 13:00 WIB focus on Sesi Sore (15:00 - 16:00)
  return now.totalMinutes < 13 * 60 ? "SIANG" : "SORE";
}

export function formatIndonesianDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(dt);
}
