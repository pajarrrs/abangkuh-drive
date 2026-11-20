"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Bell,
  ClipboardList,
  Receipt,
  Shield,
  ShoppingBag,
  Store,
  User,
  Users,
  X,
} from "lucide-react";
import { formatIndonesianDate, formatRupiah, getJakartaNow } from "@/lib/format";
import {
  getSessionTimeState,
  playNotificationSound,
  sendBrowserNotification,
  unlockNotificationAudio,
  type NotificationSoundKind,
} from "@/lib/notifications";
import type {
  Merchant,
  MerchantBatch,
  ObLocationInfo,
  OrderRecord,
  OrderSession,
  PhoneChangeRequest,
  UserProfile,
} from "@/lib/types";
import { AdminMonitorTab } from "./AdminMonitorTab";
import { AdminUsersTab } from "./AdminUsersTab";
import { AuthScreen } from "./AuthScreen";
import { EmployeeOrderTab } from "./EmployeeOrderTab";
import { EmployeePaymentsTab } from "./EmployeePaymentsTab";
import { OBDashboardTab } from "./OBDashboardTab";
import { OBMerchantsTab } from "./OBMerchantsTab";
import { OBRecapTab } from "./OBRecapTab";

type EmployeeTab = "order" | "payments" | "profile";
type OBTab = "tasks" | "recap" | "merchants" | "profile";
type AdminTab = "monitor" | "orders" | "users" | "merchants" | "profile";

export function AbangkuhApp() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);

  const [todayDate, setTodayDate] = useState("");
  const [currentTimeWib, setCurrentTimeWib] = useState("");
  const [sessions, setSessions] = useState<OrderSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [myOrders, setMyOrders] = useState<OrderRecord[]>([]);
  const [obBatches, setObBatches] = useState<MerchantBatch[]>([]);
  const [obLocations, setObLocations] = useState<ObLocationInfo[]>([]);
  const [phoneRequests, setPhoneRequests] = useState<PhoneChangeRequest[]>([]);

  const [empTab, setEmpTab] = useState<EmployeeTab>("order");
  const [obTab, setObTab] = useState<OBTab>("tasks");
  const [adminTab, setAdminTab] = useState<AdminTab>("monitor");
  const [refreshing, setRefreshing] = useState(false);

  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const [notifFeed, setNotifFeed] = useState<
    Array<{
      id: string;
      title: string;
      body: string;
      time: string;
      unread: boolean;
    }>
  >([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifPermission, setNotifPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission;
  });

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenWaitingOrderIdsRef = useRef<Set<number> | null>(null);
  const seenBatchOrderIdsRef = useRef<Map<number, Set<number>>>(new Map());
  const seenProofOrderIdsRef = useRef<Map<number, Set<number>>>(new Map());
  const prevSessionStatusRef = useRef<Map<number, string>>(new Map());
  const sessionAlertedKeysRef = useRef<Set<string>>(new Set());

  const notify = useCallback(
    (message: string, tone: "success" | "error" = "success") => {
      setToast({ message, tone });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 4000);
    },
    []
  );

  const pushAlert = useCallback(
    (title: string, body: string, sound: NotificationSoundKind) => {
      playNotificationSound(sound);
      notify(`${title}: ${body}`, "success");
      sendBrowserNotification(title, body);

      const { time } = getJakartaNow();
      setNotifFeed((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title,
            body,
            time: `${time} WIB`,
            unread: true,
          },
          ...prev,
        ].slice(0, 20)
      );
    },
    [notify]
  );

  async function requestBrowserNotifPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      if (result === "granted") {
        playNotificationSound("session");
        notify("Notifikasi browser aktif!", "success");
      } else if (result === "denied") {
        notify("Izin notifikasi ditolak di pengaturan browser.", "error");
      }
    } catch {
      // Ignore permission errors
    }
  }

  useEffect(() => {
    const unlock = () => {
      unlockNotificationAudio();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const loadWorkspaceData = useCallback(
    async (activeUser: UserProfile, preferredSessionId?: number | null) => {
      const [sessRes, merchRes, locRes, meRes] = await Promise.all([
        fetch("/api/sessions/today", { cache: "no-store" }),
        fetch("/api/merchants", { cache: "no-store" }),
        fetch("/api/ob-locations", { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);

      if (sessRes.status === 401) {
        setUser(null);
        return;
      }

      const sessData = sessRes.ok ? await sessRes.json().catch(() => ({})) : {};
      const merchData = merchRes.ok ? await merchRes.json().catch(() => ({})) : {};
      const locData = locRes.ok ? await locRes.json().catch(() => ({ locations: [] })) : { locations: [] };
      if (meRes.ok) {
        const meData = await meRes.json().catch(() => ({}));
        if (meData.user) setUser(meData.user);
      }

      const fetchedSessions: OrderSession[] = sessData.sessions ?? [];
      setTodayDate(sessData.date ?? "");
      setCurrentTimeWib(sessData.time ?? "");
      setSessions(fetchedSessions);
      setMerchants(merchData.merchants ?? []);
      setObLocations(locData.locations ?? []);

      // Detect session status changes pushed by Driver / Admin
      for (const s of fetchedSessions) {
        const prevStatus = prevSessionStatusRef.current.get(s.id);
        if (prevStatus && prevStatus !== s.status) {
          if (s.status === "OPEN") {
            pushAlert("Sesi Dibuka", `${s.label} sekarang dibuka untuk pesanan.`, "session");
          } else if (s.status === "SHOPPING") {
            pushAlert("Order Ditutup", `${s.label} — Driver sedang belanja.`, "session");
          } else if (s.status === "COMPLETED") {
            pushAlert("Sesi Selesai", `${s.label} sudah selesai.`, "session");
          }
        }
        prevSessionStatusRef.current.set(s.id, s.status);
      }

      const resolvedSessionId =
        preferredSessionId &&
        fetchedSessions.some((s) => s.id === preferredSessionId)
          ? preferredSessionId
          : fetchedSessions.find((s) => s.slot === sessData.recommendedSlot)?.id ??
            fetchedSessions[0]?.id ??
            null;

      setSelectedSessionId(resolvedSessionId);

      if (activeUser.role === "OB" || activeUser.role === "ADMIN") {
        if (resolvedSessionId) {
          const batchRes = await fetch(
            `/api/orders?scope=batches&sessionId=${resolvedSessionId}`,
            { cache: "no-store" }
          );
          if (batchRes.ok) {
            const batchData = await batchRes.json();
            const fetchedBatches: MerchantBatch[] = batchData.batches ?? [];
            setObBatches(fetchedBatches);

            const allActiveOrders = fetchedBatches.flatMap((b) =>
              b.orders.filter((o) => o.payment_status !== "CANCELLED")
            );
            const prevOrderIds = seenBatchOrderIdsRef.current.get(resolvedSessionId);
            if (prevOrderIds) {
              const newOrders = allActiveOrders.filter((o) => !prevOrderIds.has(o.id));
              if (newOrders.length === 1) {
                const o = newOrders[0];
                pushAlert(
                  "Pesanan Baru Masuk",
                  `${o.user_name} · ${o.merchant_name} (${formatRupiah(o.effective_total)})`,
                  "order"
                );
              } else if (newOrders.length > 1) {
                pushAlert(
                  "Pesanan Baru Masuk",
                  `${newOrders.length} pesanan baru masuk di sesi ini.`,
                  "order"
                );
              }
            }
            seenBatchOrderIdsRef.current.set(
              resolvedSessionId,
              new Set(allActiveOrders.map((o) => o.id))
            );

            const proofOrders = allActiveOrders.filter(
              (o) => o.payment_status === "PROOF_UPLOADED"
            );
            const prevProofIds = seenProofOrderIdsRef.current.get(resolvedSessionId);
            if (prevProofIds) {
              const newProofs = proofOrders.filter((o) => !prevProofIds.has(o.id));
              if (newProofs.length > 0) {
                const first = newProofs[0];
                pushAlert(
                  "Bukti Transfer Masuk",
                  `${first.user_name} · ${first.merchant_name} menunggu verifikasi.`,
                  "payment"
                );
              }
            }
            seenProofOrderIdsRef.current.set(
              resolvedSessionId,
              new Set(proofOrders.map((o) => o.id))
            );
          }
        }
        if (activeUser.role === "ADMIN") {
          const prRes = await fetch("/api/admin/phone-requests", {
            cache: "no-store",
          });
          if (prRes.ok) {
            const prData = await prRes.json();
            setPhoneRequests(prData.requests ?? []);
          }
        }
      } else {
        const ordRes = await fetch("/api/orders?scope=mine", { cache: "no-store" });
        if (ordRes.ok) {
          const ordData = await ordRes.json();
          const fetchedOrders: OrderRecord[] = ordData.orders ?? [];
          setMyOrders(fetchedOrders);

          const currentWaiting = fetchedOrders.filter(
            (o) => o.payment_status === "WAITING_PAYMENT"
          );
          if (seenWaitingOrderIdsRef.current !== null) {
            const newlyReady = currentWaiting.filter(
              (o) => !seenWaitingOrderIdsRef.current!.has(o.id)
            );
            if (newlyReady.length > 0) {
              pushAlert(
                "Tagihan & QRIS Siap",
                `${newlyReady[0].merchant_name} (${formatRupiah(
                  newlyReady[0].effective_total
                )}) — cek tab Pesanan.`,
                "payment"
              );
            }
          }
          seenWaitingOrderIdsRef.current = new Set(
            currentWaiting.map((o) => o.id)
          );
        }
      }
    },
    [pushAlert]
  );

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (data.user) {
          setUser(data.user);
          await loadWorkspaceData(data.user);
        }
      } catch {
        // Ignore transient network/HMR error on initial bootstrap
      } finally {
        if (active) setBooting(false);
      }
    }
    init();
    return () => {
      active = false;
    };
  }, [loadWorkspaceData]);

  const handleSelectSession = useCallback(
    async (sessionId: number) => {
      setSelectedSessionId(sessionId);
      if (user?.role === "OB" || user?.role === "ADMIN") {
        const res = await fetch(
          `/api/orders?scope=batches&sessionId=${sessionId}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json();
          setObBatches(data.batches ?? []);
        }
      }
    },
    [user]
  );

  const handleManualRefresh = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      await loadWorkspaceData(user, selectedSessionId);
    } finally {
      setRefreshing(false);
    }
  }, [user, selectedSessionId, loadWorkspaceData]);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadWorkspaceData(user, selectedSessionId).catch(() => {});
      }
    }, 6000);
    return () => clearInterval(interval);
  }, [user, selectedSessionId, loadWorkspaceData]);

  // Monitor live WIB clock for session entry, 5-minute warning, and past-cutoff alerts
  useEffect(() => {
    if (!user || sessions.length === 0) return;

    function checkSessionSchedule() {
      const { time } = getJakartaNow();
      setCurrentTimeWib(time);

      for (const s of sessions) {
        const state = getSessionTimeState(s.open_time, s.close_time);
        const keyBase = `${s.session_date}-${s.slot}-${user!.role}`;

        const fireOnce = (suffix: string, title: string, body: string) => {
          const fullKey = `${keyBase}-${suffix}`;
          if (sessionAlertedKeysRef.current.has(fullKey)) return;
          try {
            if (sessionStorage.getItem(`abk_notif_${fullKey}`)) {
              sessionAlertedKeysRef.current.add(fullKey);
              return;
            }
            sessionStorage.setItem(`abk_notif_${fullKey}`, "1");
          } catch {}
          sessionAlertedKeysRef.current.add(fullKey);
          pushAlert(title, body, "session");
        };

        if (state === "ACTIVE" && s.status === "OPEN") {
          fireOnce(
            "ENTER",
            `Masuk ${s.slot === "SIANG" ? "Sesi Siang" : "Sesi Sore"}`,
            user!.role === "EMPLOYEE"
              ? `Jadwal ${s.open_time}–${s.close_time} WIB dimulai. Yuk mulai titip pesanan!`
              : `Jadwal ${s.open_time}–${s.close_time} WIB dimulai. Pantau pesanan yang masuk.`
          );
        } else if (state === "CLOSING_SOON" && s.status === "OPEN") {
          fireOnce(
            "CLOSING",
            "5 Menit Lagi Sesi Tutup",
            `${s.label} segera berakhir pukul ${s.close_time} WIB.`
          );
        } else if (state === "PAST" && s.status === "OPEN") {
          fireOnce(
            "PAST",
            "Waktu Sesi Sudah Lewat",
            user!.role === "EMPLOYEE"
              ? `Jadwal ${s.label} sudah lewat (${s.close_time} WIB).`
              : `Jadwal ${s.label} sudah lewat (${s.close_time} WIB). Klik Belanja untuk tutup order.`
          );
        }
      }
    }

    checkSessionSchedule();
    const timer = setInterval(checkSessionSchedule, 15000);
    return () => clearInterval(timer);
  }, [user, sessions, pushAlert]);

  async function handleAuthenticated(loggedInUser: UserProfile) {
    setUser(loggedInUser);
    setEmpTab("order");
    setObTab("tasks");
    setAdminTab("monitor");
    await loadWorkspaceData(loggedInUser);
    notify(`Halo, ${loggedInUser.name}.`, "success");
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setMyOrders([]);
    setObBatches([]);
    setPhoneRequests([]);
    setNotifFeed([]);
    setNotifOpen(false);
    seenWaitingOrderIdsRef.current = null;
    seenBatchOrderIdsRef.current.clear();
    seenProofOrderIdsRef.current.clear();
    prevSessionStatusRef.current.clear();
    sessionAlertedKeysRef.current.clear();
  }

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId]
  );

  const waitingQrisBadge = useMemo(
    () => myOrders.filter((o) => o.payment_status === "WAITING_PAYMENT").length,
    [myOrders]
  );

  const obPendingVerifyBadge = useMemo(
    () =>
      obBatches.reduce((sum, b) => sum + b.summary.pending_verification_count, 0),
    [obBatches]
  );

  const pendingPhoneBadge = useMemo(
    () => phoneRequests.filter((r) => r.status === "PENDING").length,
    [phoneRequests]
  );

  const unreadNotifCount = useMemo(
    () => notifFeed.filter((n) => n.unread).length,
    [notifFeed]
  );

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-3 border-[#E2E8F0] border-t-[#E8472E]" />
          <p className="text-xs font-semibold text-[#5B6B7C]">Memuat Abangku Driver...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  const isAdmin = user.role === "ADMIN";
  const isOB = user.role === "OB";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-white shadow-xl sm:border-x sm:border-[#E2E8F0]">
      {/* Minimal Brand Top Bar in Alturian Navy */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-[#071E33] px-4 py-3 text-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <svg
            width="24"
            height="24"
            viewBox="0 0 512 512"
            aria-hidden="true"
            className="shrink-0"
          >
            <path d="M256 64 L356 236 L156 236 Z" fill="#E8472E" />
            <path d="M156 256 L256 428 L56 428 Z" fill="#FE583E" />
            <path d="M356 256 L456 428 L256 428 Z" fill="#FFFFFF" />
            <path d="M256 256 L342 406 L170 406 Z" fill="#AFC6DC" />
          </svg>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold tracking-tight">
                Abangku Driver
              </span>
              {isAdmin && (
                <span className="rounded bg-[#E8472E] px-1.5 py-0.5 text-[10px] font-bold">
                  ADMIN
                </span>
              )}
              {isOB && (
                <span className="rounded bg-[#E8472E] px-1.5 py-0.5 text-[10px] font-bold">
                  DRIVER
                </span>
              )}
            </div>
            <p className="truncate text-[10px] text-[#AFC6DC]">
              {todayDate ? formatIndonesianDate(todayDate) : "Hari ini"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setNotifOpen(true);
              setNotifFeed((prev) => prev.map((n) => ({ ...n, unread: false })));
            }}
            className="relative flex h-8 w-8 items-center justify-center rounded-full bg-[#102D47] text-[#AFC6DC] hover:text-white"
            aria-label="Notifikasi"
            title="Notifikasi"
          >
            <Bell className="h-4 w-4" />
            {(unreadNotifCount > 0 || notifPermission === "default") && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E8472E] px-1 text-[9px] font-extrabold text-white">
                {unreadNotifCount > 0 ? unreadNotifCount : "!"}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={handleManualRefresh}
            className="rounded-full bg-[#102D47] px-3 py-1.5 text-[11px] font-bold text-[#AFC6DC] hover:text-white"
          >
            {refreshing ? "Memuat..." : "Segarkan"}
          </button>
        </div>
      </header>

      {/* Notification Center Sheet */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#071E33]/65 sm:items-center sm:p-4"
          onClick={() => setNotifOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#EDF1F5] px-5 py-4">
              <div>
                <h3 className="text-base font-extrabold text-[#071E33]">
                  Notifikasi
                </h3>
                <p className="text-[11px] text-[#5B6B7C]">
                  Pesanan masuk, jadwal sesi & tagihan QRIS
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNotifOpen(false)}
                className="rounded-full p-1.5 text-[#5B6B7C] hover:bg-[#F4F6F9]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {notifPermission === "default" && (
              <div className="flex items-center justify-between gap-3 border-b border-[#EDF1F5] bg-[#F8FAFC] px-5 py-2.5">
                <p className="text-xs font-semibold text-[#071E33]">
                  Aktifkan notifikasi browser
                </p>
                <button
                  type="button"
                  onClick={requestBrowserNotifPermission}
                  className="shrink-0 rounded-full bg-[#E8472E] px-3.5 py-1 text-[11px] font-bold text-white"
                >
                  Izinkan
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {notifFeed.length === 0 ? (
                <p className="py-10 text-center text-xs text-[#5B6B7C]">
                  Belum ada notifikasi baru hari ini.
                </p>
              ) : (
                <div className="divide-y divide-[#EDF1F5]">
                  {notifFeed.map((item) => (
                    <div key={item.id} className="py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs font-extrabold text-[#071E33]">
                          {item.title}
                        </p>
                        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-[#6B7C8F]">
                          {item.time}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-[#5B6B7C]">{item.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 w-[90%] max-w-sm -translate-x-1/2">
          <div
            className={`rounded-2xl px-4 py-3 text-xs font-bold text-white shadow-lg ${
              toast.tone === "error" ? "bg-[#C81E1E]" : "bg-[#071E33]"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 bg-white pb-20">
        {isAdmin ? (
          <>
            {adminTab === "monitor" && (
              <AdminMonitorTab
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                onSelectSession={handleSelectSession}
                currentTimeWib={currentTimeWib}
                batches={obBatches}
                obLocations={obLocations}
                onRefresh={handleManualRefresh}
                onNotify={notify}
              />
            )}
            {adminTab === "orders" && (
              <OBDashboardTab
                currentUser={user}
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                onSelectSession={handleSelectSession}
                currentTimeWib={currentTimeWib}
                batches={obBatches}
                obLocations={obLocations}
                onRefresh={handleManualRefresh}
                onNotify={notify}
              />
            )}
            {adminTab === "users" && (
              <AdminUsersTab
                currentUser={user}
                phoneRequests={phoneRequests}
                onRequestsChanged={handleManualRefresh}
                onNotify={notify}
              />
            )}
            {adminTab === "merchants" && (
              <OBMerchantsTab
                merchants={merchants}
                canDelete
                onRefresh={handleManualRefresh}
                onNotify={notify}
              />
            )}
            {adminTab === "profile" && (
              <ProfileView
                user={user}
                onProfileUpdated={(u) => setUser(u)}
                onNotify={notify}
                onLogout={handleLogout}
              />
            )}
          </>
        ) : isOB ? (
          <>
            {obTab === "tasks" && (
              <OBDashboardTab
                currentUser={user}
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                onSelectSession={handleSelectSession}
                currentTimeWib={currentTimeWib}
                batches={obBatches}
                obLocations={obLocations}
                onRefresh={handleManualRefresh}
                onNotify={notify}
              />
            )}
            {obTab === "recap" && (
              <OBRecapTab
                selectedSession={selectedSession}
                batches={obBatches}
              />
            )}
            {obTab === "merchants" && (
              <OBMerchantsTab
                merchants={merchants}
                onRefresh={handleManualRefresh}
                onNotify={notify}
              />
            )}
            {obTab === "profile" && (
              <ProfileView
                user={user}
                onProfileUpdated={(u) => setUser(u)}
                onNotify={notify}
                onLogout={handleLogout}
              />
            )}
          </>
        ) : (
          <>
            {empTab === "order" && (
              <EmployeeOrderTab
                currentUser={user}
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                onSelectSession={handleSelectSession}
                currentTimeWib={currentTimeWib}
                merchants={merchants}
                myOrders={myOrders}
                obLocations={obLocations}
                onOrderCreated={handleManualRefresh}
                onGoToPayments={() => setEmpTab("payments")}
                onNotify={notify}
              />
            )}
            {empTab === "payments" && (
              <EmployeePaymentsTab
                orders={myOrders}
                obLocations={obLocations}
                onRefresh={handleManualRefresh}
                onNotify={notify}
              />
            )}
            {empTab === "profile" && (
              <ProfileView
                user={user}
                onProfileUpdated={(u) => setUser(u)}
                onNotify={notify}
                onLogout={handleLogout}
              />
            )}
          </>
        )}
      </main>

      {/* Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-md -translate-x-1/2 border-t border-[#E6EBF0] bg-white px-2 py-1.5">
        {isAdmin ? (
          <div className="grid grid-cols-5">
            <NavButton
              active={adminTab === "monitor"}
              onClick={() => setAdminTab("monitor")}
              icon={<Shield className="h-5 w-5" />}
              label="Monitor"
            />
            <NavButton
              active={adminTab === "orders"}
              onClick={() => setAdminTab("orders")}
              icon={<ClipboardList className="h-5 w-5" />}
              label="Order"
              badge={obPendingVerifyBadge}
            />
            <NavButton
              active={adminTab === "users"}
              onClick={() => setAdminTab("users")}
              icon={<Users className="h-5 w-5" />}
              label="User"
              badge={pendingPhoneBadge}
            />
            <NavButton
              active={adminTab === "merchants"}
              onClick={() => setAdminTab("merchants")}
              icon={<Store className="h-5 w-5" />}
              label="Warung"
            />
            <NavButton
              active={adminTab === "profile"}
              onClick={() => setAdminTab("profile")}
              icon={<User className="h-5 w-5" />}
              label="Akun"
            />
          </div>
        ) : isOB ? (
          <div className="grid grid-cols-4">
            <NavButton
              active={obTab === "tasks"}
              onClick={() => setObTab("tasks")}
              icon={<ClipboardList className="h-5 w-5" />}
              label="Belanja"
              badge={obPendingVerifyBadge}
            />
            <NavButton
              active={obTab === "recap"}
              onClick={() => setObTab("recap")}
              icon={<BarChart3 className="h-5 w-5" />}
              label="Rekap"
            />
            <NavButton
              active={obTab === "merchants"}
              onClick={() => setObTab("merchants")}
              icon={<Store className="h-5 w-5" />}
              label="Warung"
            />
            <NavButton
              active={obTab === "profile"}
              onClick={() => setObTab("profile")}
              icon={<User className="h-5 w-5" />}
              label="Akun"
            />
          </div>
        ) : (
          <div className="grid grid-cols-3">
            <NavButton
              active={empTab === "order"}
              onClick={() => setEmpTab("order")}
              icon={<ShoppingBag className="h-5 w-5" />}
              label="Pesan"
            />
            <NavButton
              active={empTab === "payments"}
              onClick={() => setEmpTab("payments")}
              icon={<Receipt className="h-5 w-5" />}
              label="Pesanan"
              badge={waitingQrisBadge}
            />
            <NavButton
              active={empTab === "profile"}
              onClick={() => setEmpTab("profile")}
              icon={<User className="h-5 w-5" />}
              label="Akun"
            />
          </div>
        )}
      </nav>
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-bold transition ${
        active ? "text-[#E8472E]" : "text-[#6B7C8F] hover:text-[#071E33]"
      }`}
    >
      <span className="relative">
        {icon}
        {badge && badge > 0 ? (
          <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E8472E] px-1 text-[10px] font-extrabold text-white">
            {badge}
          </span>
        ) : null}
      </span>
      <span>{label}</span>
    </button>
  );
}

function ProfileView({
  user,
  onProfileUpdated,
  onNotify,
  onLogout,
}: {
  user: UserProfile;
  onProfileUpdated: (user: UserProfile) => void;
  onNotify: (msg: string, tone?: "success" | "error") => void;
  onLogout: () => void;
}) {
  const [whatsapp, setWhatsapp] = useState(user.whatsapp || "");
  const [savingContact, setSavingContact] = useState(false);

  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);

  const latestReq = user.latest_phone_request ?? null;

  async function handleSavePhone(e: React.FormEvent) {
    e.preventDefault();
    setSavingContact(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsapp: whatsapp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal memperbarui no. telepon.", "error");
        return;
      }
      onProfileUpdated(data.user);
      if (data.phone_request_pending) {
        onNotify("Pengajuan ganti no. telepon dikirim. Menunggu approval Admin.", "success");
      } else {
        onNotify("No. telepon diperbarui.", "success");
      }
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setSavingContact(false);
    }
  }

  async function handleChangePin(e: React.FormEvent) {
    e.preventDefault();
    if (newPin !== confirmPin) {
      onNotify("Konfirmasi PIN baru tidak cocok.", "error");
      return;
    }
    setSavingPin(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_pin: currentPin.trim(),
          new_pin: newPin.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal mengubah PIN.", "error");
        return;
      }
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      onNotify("PIN / password berhasil diganti.", "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setSavingPin(false);
    }
  }

  return (
    <div className="bg-white pb-8">
      <div className="bg-[#071E33] px-5 pb-6 pt-5 text-white">
        <div className="flex items-center gap-3.5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E8472E] text-lg font-extrabold text-white">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-extrabold">{user.name}</h2>
            <p className="truncate text-xs text-[#AFC6DC]">@{user.username}</p>
            <p className="mt-0.5 text-xs text-white/80">
              {user.whatsapp || "Belum ada no. telepon"}
            </p>
          </div>
        </div>
      </div>

      {/* Phone Number Form (Requires Admin Approval for non-Admin) */}
      <form onSubmit={handleSavePhone} className="space-y-3 px-5 py-5">
        <div>
          <h3 className="text-sm font-extrabold text-[#071E33]">
            No. Telepon / WhatsApp
          </h3>
          {user.role !== "ADMIN" && (
            <p className="mt-0.5 text-[11px] text-[#5B6B7C]">
              Setiap perubahan no. telepon memerlukan persetujuan Super Admin.
            </p>
          )}
        </div>

        {latestReq?.status === "PENDING" && (
          <div className="rounded-xl bg-[#FFF1EE] px-3.5 py-2.5 text-xs text-[#C7331D]">
            <strong>Menunggu approval Admin:</strong> perubahan ke{" "}
            <span className="font-extrabold tabular-nums">{latestReq.new_whatsapp}</span>
          </div>
        )}

        {latestReq?.status === "REJECTED" && (
          <div className="rounded-xl bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#C81E1E]">
            <strong>Pengajuan ditolak ({latestReq.new_whatsapp}):</strong>{" "}
            {latestReq.reject_reason || "Silakan ajukan ulang."}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-bold text-[#071E33]">
            {user.role === "ADMIN" ? "No. Telepon" : "No. Telepon Baru"}
          </label>
          <input
            type="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="0812xxxxxxxx"
            required
            className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-sm text-[#071E33] outline-none focus:border-[#071E33] focus:bg-white"
          />
        </div>
        <button
          type="submit"
          disabled={savingContact}
          className="w-full rounded-full bg-[#071E33] py-3 text-xs font-bold text-white hover:bg-[#102D47] disabled:opacity-60"
        >
          {savingContact
            ? "Mengirim..."
            : user.role === "ADMIN"
            ? "Simpan No. Telepon"
            : latestReq?.status === "PENDING"
            ? "Ubah Pengajuan No. Telepon"
            : "Ajukan Ganti No. Telepon"}
        </button>
      </form>

      <div className="h-2 bg-[#F4F6F9]" />

      {/* Change PIN / Password Form */}
      <form onSubmit={handleChangePin} className="space-y-3 px-5 py-5">
        <h3 className="text-sm font-extrabold text-[#071E33]">
          Ganti PIN / Password
        </h3>
        <div>
          <label className="mb-1 block text-xs font-bold text-[#071E33]">
            PIN Lama
          </label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Masukkan PIN saat ini"
            required
            className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-sm tracking-widest text-[#071E33] outline-none focus:border-[#071E33] focus:bg-white"
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="mb-1 block text-xs font-bold text-[#071E33]">
              PIN Baru (4–6 digit)
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              required
              className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-sm tracking-widest text-[#071E33] outline-none focus:border-[#071E33] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-[#071E33]">
              Ulangi PIN Baru
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              required
              className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-sm tracking-widest text-[#071E33] outline-none focus:border-[#071E33] focus:bg-white"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={savingPin}
          className="w-full rounded-full bg-[#E8472E] py-3 text-xs font-bold text-white hover:bg-[#D13B24] disabled:opacity-60"
        >
          {savingPin ? "Mengubah..." : "Ganti PIN"}
        </button>
      </form>

      <div className="h-2 bg-[#F4F6F9]" />

      <div className="px-5 py-5">
        <button
          type="button"
          onClick={onLogout}
          className="w-full rounded-full border border-[#F5B7B1] bg-[#FEF2F2] py-3 text-sm font-bold text-[#C81E1E] hover:bg-[#FDE2E2]"
        >
          Keluar / Ganti Akun
        </button>
      </div>
    </div>
  );
}
