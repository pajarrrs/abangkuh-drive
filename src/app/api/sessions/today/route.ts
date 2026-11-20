import { ensureTodaySessions } from "@/lib/db";
import { getJakartaNow, getRecommendedSlot } from "@/lib/format";
import { requireAuth } from "@/lib/session";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const sessions = ensureTodaySessions();
  const now = getJakartaNow();

  return Response.json({
    date: now.date,
    time: now.time,
    recommendedSlot: getRecommendedSlot(),
    sessions,
  });
}
