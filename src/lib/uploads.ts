import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

function detectImageExt(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { ext: "png", mime: "image/png" };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export async function saveUploadedImage(
  file: File,
  prefix: "qris" | "proof" | "receipt"
): Promise<{ url: string; filename: string }> {
  if (file.size === 0) {
    throw new Error("File gambar kosong.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Ukuran gambar maksimal 5MB.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  const detected = detectImageExt(buf);
  if (!detected) {
    throw new Error("Format file harus gambar PNG, JPG, atau WEBP.");
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${detected.ext}`;
  const dest = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(dest, buf);

  return {
    filename,
    url: `/api/uploads/${filename}`,
  };
}

export function isValidUploadFilename(filename: string): boolean {
  return /^(qris|proof|receipt)-\d+-[a-f0-9]{8}\.(png|jpg|webp)$/.test(filename);
}

export function getMimeFromFilename(filename: string): string {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
