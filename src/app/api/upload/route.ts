import { requireAuth } from "@/lib/session";
import { saveUploadedImage } from "@/lib/uploads";

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const kind = String(formData.get("kind") || "proof");

    if (!(file instanceof File)) {
      return Response.json({ error: "File gambar wajib dilampirkan." }, { status: 400 });
    }

    const canUploadMerchantAssets =
      auth.user.role === "OB" || auth.user.role === "ADMIN";
    const prefix =
      kind === "qris" && canUploadMerchantAssets
        ? "qris"
        : kind === "receipt" && canUploadMerchantAssets
        ? "receipt"
        : "proof";

    const saved = await saveUploadedImage(file, prefix);
    return Response.json(saved, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mengunggah gambar.";
    return Response.json({ error: message }, { status: 400 });
  }
}
