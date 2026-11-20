"use client";

import { useState } from "react";
import type { UserProfile } from "@/lib/types";

interface AuthScreenProps {
  onAuthenticated: (user: UserProfile) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), pin: pin.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal masuk.");
        return;
      }
      onAuthenticated(data.user);
    } catch {
      setError("Koneksi bermasalah. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim(),
          whatsapp: whatsapp.trim(),
          pin: pin.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal mendaftar.");
        return;
      }
      onAuthenticated(data.user);
    } catch {
      setError("Koneksi bermasalah. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-white sm:border-x sm:border-[#E2E8F0]">
      {/* Alturian Navy Top Brand Header */}
      <div className="bg-[#071E33] px-6 pb-10 pt-10 text-white">
        <div className="flex items-center gap-3">
          <svg
            width="36"
            height="36"
            viewBox="0 0 512 512"
            aria-hidden="true"
            className="shrink-0"
          >
            <path d="M256 64 L356 236 L156 236 Z" fill="#E8472E" />
            <path d="M156 256 L256 428 L56 428 Z" fill="#FE583E" />
            <path d="M356 256 L456 428 L256 428 Z" fill="#FFFFFF" />
            <path d="M256 256 L342 406 L170 406 Z" fill="#AFC6DC" />
          </svg>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Abangku Driver</h1>
            <p className="text-xs text-[#AFC6DC]">Titip makan & barang kantor</p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-white/85">
          Pesan di <strong>Sesi Siang (10:00–10:30)</strong> atau{" "}
          <strong>Sesi Sore (15:00–16:00)</strong>. QRIS pedagang langsung masuk ke
          pesananmu tanpa spam grup.
        </p>
      </div>

      {/* White Sheet Body */}
      <div className="-mt-5 flex-1 rounded-t-3xl bg-white px-6 pb-8 pt-5">
        {/* Clean Underline Tabs */}
        <div className="mb-6 flex border-b border-[#E6EBF0]">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={`flex-1 pb-3 text-sm font-bold transition ${
              mode === "login"
                ? "border-b-2 border-[#E8472E] text-[#071E33]"
                : "text-[#6B7C8F]"
            }`}
          >
            Masuk
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
              setPin("");
            }}
            className={`flex-1 pb-3 text-sm font-bold transition ${
              mode === "register"
                ? "border-b-2 border-[#E8472E] text-[#071E33]"
                : "text-[#6B7C8F]"
            }`}
          >
            Daftar Baru
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-semibold text-[#C81E1E]">
            {error}
          </div>
        )}

        {mode === "login" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-[#071E33]">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Masukkan username"
                required
                className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-4 py-3 text-sm text-[#071E33] outline-none focus:border-[#071E33] focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-[#071E33]">
                PIN (4–6 digit)
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="Masukkan PIN"
                required
                className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-4 py-3 text-sm tracking-widest text-[#071E33] outline-none focus:border-[#071E33] focus:bg-white"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full bg-[#E8472E] py-3.5 text-sm font-bold text-white transition hover:bg-[#D13B24] active:scale-[0.99] disabled:opacity-60"
            >
              {submitting ? "Memproses..." : "Masuk"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-3.5">
            <div>
              <label className="mb-1 block text-xs font-bold text-[#071E33]">
                Nama Lengkap
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Masukkan nama lengkap"
                required
                className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-4 py-3 text-sm outline-none focus:border-[#071E33] focus:bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1 block text-xs font-bold text-[#071E33]">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  required
                  className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-3 text-sm outline-none focus:border-[#071E33] focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-[#071E33]">
                  PIN (4–6 digit)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="4–6 digit"
                  required
                  className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-3.5 py-3 text-sm tracking-widest outline-none focus:border-[#071E33] focus:bg-white"
                />
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
                className="w-full rounded-xl border border-[#D7E0E8] bg-[#F8FAFC] px-4 py-3 text-sm outline-none focus:border-[#071E33] focus:bg-white"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="mt-2 w-full rounded-full bg-[#E8472E] py-3.5 text-sm font-bold text-white transition hover:bg-[#D13B24] disabled:opacity-60"
            >
              {submitting ? "Mendaftarkan..." : "Daftar & Masuk"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
