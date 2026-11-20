import { cookies } from "next/headers";
import { signSessionToken, verifySessionToken } from "./auth-crypto";
import { getDb } from "./db";
import type { UserProfile } from "./types";

export const SESSION_COOKIE_NAME = "abangkuh_session";

export async function setSessionCookie(userId: number, role: "EMPLOYEE" | "OB" | "ADMIN") {
  const token = signSessionToken(userId, role);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser(): Promise<UserProfile | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const db = getDb();
  const user = db
    .prepare(
      "SELECT id, name, username, division, whatsapp, role, created_at FROM users WHERE id = ?"
    )
    .get(payload.userId) as unknown as UserProfile | undefined;

  return user ?? null;
}

export async function requireAuth(): Promise<
  { user: UserProfile; error: null } | { user: null; error: Response }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      user: null,
      error: Response.json(
        { error: "Silakan login terlebih dahulu." },
        { status: 401 }
      ),
    };
  }
  return { user, error: null };
}

export async function requireOB(): Promise<
  { user: UserProfile; error: null } | { user: null; error: Response }
> {
  const auth = await requireAuth();
  if (auth.error) return auth;
  if (auth.user.role !== "OB" && auth.user.role !== "ADMIN") {
    return {
      user: null,
      error: Response.json(
        { error: "Akses khusus Driver / Admin." },
        { status: 403 }
      ),
    };
  }
  return auth;
}

export async function requireAdmin(): Promise<
  { user: UserProfile; error: null } | { user: null; error: Response }
> {
  const auth = await requireAuth();
  if (auth.error) return auth;
  if (auth.user.role !== "ADMIN") {
    return {
      user: null,
      error: Response.json(
        { error: "Akses khusus Super Admin." },
        { status: 403 }
      ),
    };
  }
  return auth;
}
