"use client";

import { X } from "lucide-react";

interface ImageModalProps {
  src: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}

export function ImageModal({ src, title, subtitle, onClose }: ImageModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#071E33]/80 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#EDF1F5] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-[#071E33]">{title}</h3>
            {subtitle && (
              <p className="truncate text-xs text-[#5B6B7C]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[#5B6B7C] hover:bg-[#F4F6F9]"
            aria-label="Tutup"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex max-h-[62vh] items-center justify-center overflow-auto bg-[#F4F6F9] p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={title}
            className="max-h-[56vh] w-auto rounded-2xl border border-[#E2E8F0] bg-white object-contain"
          />
        </div>

        <div className="border-t border-[#EDF1F5] bg-white px-5 py-4">
          <a
            href={src}
            download
            className="block w-full rounded-full bg-[#071E33] py-3.5 text-center text-sm font-bold text-white hover:bg-[#102D47]"
          >
            Simpan Gambar ke Galeri
          </a>
        </div>
      </div>
    </div>
  );
}
