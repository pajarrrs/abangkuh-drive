"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { PhoneChangeRequest, UserProfile, UserRole } from "@/lib/types";

interface AdminUserRow extends UserProfile {
  order_count: number;
}

interface AdminUsersTabProps {
  currentUser: UserProfile;
  phoneRequests: PhoneChangeRequest[];
  onRequestsChanged: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function AdminUsersTab({
  currentUser,
  phoneRequests,
  onRequestsChanged,
  onNotify,
}: AdminUsersTabProps) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<"ALL" | UserRole>("ALL");

  // Reject reason inline state
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  // Create/Edit Modal
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [role, setRole] = useState<UserRole>("EMPLOYEE");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const pendingPhoneRequests = useMemo(
    () => phoneRequests.filter((r) => r.status === "PENDING"),
    [phoneRequests]
  );

  const filtered = useMemo(() => {
    if (roleFilter === "ALL") return users;
    return users.filter((u) => u.role === roleFilter);
  }, [users, roleFilter]);

  function openCreate() {
    setEditingUser(null);
    setName("");
    setUsername("");
    setWhatsapp("");
    setRole("EMPLOYEE");
    setPin("1234");
    setSheetOpen(true);
  }

  function openEdit(u: AdminUserRow) {
    setEditingUser(u);
    setName(u.name);
    setUsername(u.username);
    setWhatsapp(u.whatsapp);
    setRole(u.role);
    setPin("");
    setSheetOpen(true);
  }

  async function handleReviewPhoneRequest(
    reqId: number,
    action: "approve" | "reject"
  ) {
    setReviewingId(reqId);
    try {
      const res = await fetch(`/api/admin/phone-requests/${reqId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve"
            ? { action: "approve" }
            : { action: "reject", reason: rejectReason.trim() }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal memproses pengajuan.", "error");
        return;
      }
      setRejectingId(null);
      setRejectReason("");
      await Promise.all([loadUsers(), onRequestsChanged()]);
      onNotify(
        action === "approve"
          ? "Perubahan no. telepon disetujui."
          : "Perubahan no. telepon ditolak.",
        "success"
      );
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setReviewingId(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingUser) {
        const payload: Record<string, string> = {
          name: name.trim(),
          whatsapp: whatsapp.trim(),
          role,
        };
        if (pin.trim()) payload.pin = pin.trim();

        const res = await fetch(`/api/admin/users/${editingUser.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          onNotify(data.error || "Gagal menyimpan perubahan.", "error");
          return;
        }
        onNotify(`Akun ${name.trim()} diperbarui.`, "success");
      } else {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            username: username.trim(),
            whatsapp: whatsapp.trim(),
            role,
            pin: pin.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          onNotify(data.error || "Gagal membuat akun.", "error");
          return;
        }
        onNotify(`Akun ${name.trim()} berhasil dibuat.`, "success");
      }

      setSheetOpen(false);
      await loadUsers();
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(u: AdminUserRow) {
    if (!confirm(`Hapus akun ${u.name} (@${u.username})?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Gagal menghapus akun.", "error");
        return;
      }
      await loadUsers();
      onNotify(`Akun ${u.name} dihapus.`, "success");
    } catch {
      onNotify("Koneksi bermasalah.", "error");
    }
  }

  return (
    <div className="bg-white pb-8">
      <div className="flex items-center justify-between bg-[#071E33] px-4 pb-5 pt-4 text-white">
        <div>
          <h2 className="text-lg font-extrabold">Kelola Pengguna</h2>
          <p className="mt-0.5 text-xs text-[#AFC6DC]">
            Approval ganti no. telepon, akun Driver, Karyawan & Admin.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-full bg-[#E8472E] px-4 py-2 text-xs font-bold text-white hover:bg-[#D13B24]"
        >
          + Tambah
        </button>
      </div>

      {/* Pending Phone Change Approvals */}
      {pendingPhoneRequests.length > 0 && (
        <section className="border-b-8 border-[#F4F6F9] bg-[#FFF8F6] px-4 py-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-[#C7331D]">
              Approval Ganti No. Telepon
            </h3>
            <span className="rounded-full bg-[#E8472E] px-2 py-0.5 text-[10px] font-extrabold text-white">
              {pendingPhoneRequests.length} menunggu
            </span>
          </div>

          <div className="space-y-2.5">
            {pendingPhoneRequests.map((req) => (
              <div
                key={req.id}
                className="rounded-2xl border border-[#FFD4CC] bg-white p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-extrabold text-[#071E33]">
                      {req.user_name}{" "}
                      <span className="font-medium text-[#6B7C8F]">
                        @{req.user_username}
                      </span>
                    </p>
                    <p className="mt-1 text-xs tabular-nums text-[#5B6B7C]">
                      <span>{req.old_whatsapp || "(kosong)"}</span>
                      <span className="mx-1.5 font-bold text-[#071E33]">→</span>
                      <strong className="text-[#071E33]">{req.new_whatsapp}</strong>
                    </p>
                  </div>
                </div>

                {rejectingId === req.id ? (
                  <div className="mt-2.5 space-y-2">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Alasan penolakan (opsional)"
                      className="w-full rounded-xl border border-[#F5B7B1] bg-[#FEF2F2] px-3 py-2 text-xs outline-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(null);
                          setRejectReason("");
                        }}
                        className="rounded-full border border-[#D7E0E8] py-1.5 text-xs font-bold text-[#071E33]"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        disabled={reviewingId === req.id}
                        onClick={() => handleReviewPhoneRequest(req.id, "reject")}
                        className="rounded-full bg-[#C81E1E] py-1.5 text-xs font-bold text-white"
                      >
                        Konfirmasi Tolak
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={reviewingId === req.id}
                      onClick={() => {
                        setRejectingId(req.id);
                        setRejectReason("");
                      }}
                      className="rounded-full border border-[#F5B7B1] bg-[#FEF2F2] py-1.5 text-xs font-bold text-[#C81E1E]"
                    >
                      Tolak
                    </button>
                    <button
                      type="button"
                      disabled={reviewingId === req.id}
                      onClick={() => handleReviewPhoneRequest(req.id, "approve")}
                      className="rounded-full bg-[#16884A] py-1.5 text-xs font-bold text-white"
                    >
                      Setujui
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Role Filters */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
        {(
          [
            { key: "ALL", label: `Semua (${users.length})` },
            {
              key: "OB",
              label: `Driver (${users.filter((u) => u.role === "OB").length})`,
            },
            {
              key: "EMPLOYEE",
              label: `Karyawan (${
                users.filter((u) => u.role === "EMPLOYEE").length
              })`,
            },
            {
              key: "ADMIN",
              label: `Admin (${users.filter((u) => u.role === "ADMIN").length})`,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setRoleFilter(tab.key)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold ${
              roleFilter === tab.key
                ? "bg-[#071E33] text-white"
                : "bg-[#F4F6F9] text-[#475569]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="h-2 bg-[#F4F6F9]" />

      {/* Users List */}
      <div className="divide-y divide-[#EDF1F5] px-4">
        {loading ? (
          <p className="py-10 text-center text-xs text-[#5B6B7C]">
            Memuat daftar akun...
          </p>
        ) : (
          filtered.map((u) => {
            const roleBadge =
              u.role === "ADMIN"
                ? { label: "Admin", cls: "bg-[#FFF1EE] text-[#E8472E]" }
                : u.role === "OB"
                ? { label: "Driver", cls: "bg-[#071E33] text-white" }
                : { label: "Karyawan", cls: "bg-[#F4F6F9] text-[#475569]" };

            return (
              <div
                key={u.id}
                className="flex items-center justify-between gap-3 py-3.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-extrabold text-[#071E33]">
                      {u.name}
                    </p>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${roleBadge.cls}`}
                    >
                      {roleBadge.label}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[#5B6B7C]">
                    @{u.username}
                    {u.whatsapp ? ` · ${u.whatsapp}` : ""}
                    {u.order_count > 0 ? ` · ${u.order_count} order` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(u)}
                    className="rounded-full border border-[#D7E0E8] px-3 py-1 text-[11px] font-bold text-[#071E33]"
                  >
                    Edit
                  </button>
                  {u.id !== currentUser.id && (
                    <button
                      type="button"
                      onClick={() => handleDelete(u)}
                      className="text-[11px] font-bold text-[#C81E1E]"
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create / Edit User Sheet */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#071E33]/65 sm:items-center sm:p-4"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#EDF1F5] px-5 py-4">
              <h3 className="text-base font-extrabold text-[#071E33]">
                {editingUser ? `Edit ${editingUser.name}` : "Tambah Akun Baru"}
              </h3>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-full p-1.5 text-[#5B6B7C] hover:bg-[#F4F6F9]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5 p-5">
              <div>
                <label className="mb-1 block text-xs font-bold text-[#071E33]">
                  Nama Lengkap *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-sm outline-none focus:border-[#071E33] focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {!editingUser && (
                  <div>
                    <label className="mb-1 block text-xs font-bold text-[#071E33]">
                      Username *
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-sm outline-none focus:border-[#071E33] focus:bg-white"
                    />
                  </div>
                )}

                <div className={editingUser ? "col-span-2" : ""}>
                  <label className="mb-1 block text-xs font-bold text-[#071E33]">
                    Role *
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-sm font-semibold outline-none focus:border-[#071E33] focus:bg-white"
                  >
                    <option value="EMPLOYEE">Karyawan</option>
                    <option value="OB">Abangku Driver</option>
                    <option value="ADMIN">Super Admin</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-[#071E33]">
                  No. Telepon / WhatsApp
                </label>
                <input
                  type="tel"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="0812xxxxxxxx"
                  className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-sm outline-none focus:border-[#071E33] focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-[#071E33]">
                  {editingUser
                    ? "Reset PIN (kosongkan jika tidak diubah)"
                    : "PIN (4–6 digit) *"}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  required={!editingUser}
                  placeholder={editingUser ? "Biarkan kosong jika tetap" : "1234"}
                  className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-2.5 text-sm tracking-widest outline-none focus:border-[#071E33] focus:bg-white"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="mt-1 w-full rounded-full bg-[#E8472E] py-3 text-sm font-bold text-white hover:bg-[#D13B24] disabled:opacity-60"
              >
                {saving ? "Menyimpan..." : "Simpan Akun"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
