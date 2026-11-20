import { getJakartaNow, parseTimeToMinutes } from "./format";

export type NotificationSoundKind = "order" | "session" | "payment";

export type SessionTimeState = "BEFORE" | "ACTIVE" | "CLOSING_SOON" | "PAST";

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedAudioCtx) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

/**
 * Unlocks Web Audio on the first user tap/click so later background polling
 * notifications can play sound on Chrome, Safari, and iOS.
 */
export function unlockNotificationAudio() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const silent = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = silent;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    // Ignore audio unlock errors
  }
}

export function getSessionTimeState(
  openTime: string,
  closeTime: string
): SessionTimeState {
  const { totalMinutes } = getJakartaNow();
  const start = parseTimeToMinutes(openTime);
  const end = parseTimeToMinutes(closeTime);

  if (totalMinutes < start) return "BEFORE";
  if (totalMinutes > end) return "PAST";
  if (end - totalMinutes <= 5) return "CLOSING_SOON";
  return "ACTIVE";
}

function scheduleTone(
  ctx: AudioContext,
  freq: number,
  startOffset: number,
  duration: number,
  volume: number
) {
  const start = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const harmonic = ctx.createOscillator();
  const gain = ctx.createGain();
  const harmonicGain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, start);

  harmonic.type = "sine";
  harmonic.frequency.setValueAtTime(freq * 2, start);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  harmonicGain.gain.setValueAtTime(0.0001, start);
  harmonicGain.gain.linearRampToValueAtTime(volume * 0.25, start + 0.015);
  harmonicGain.gain.exponentialRampToValueAtTime(0.0001, start + duration * 0.7);

  osc.connect(gain);
  harmonic.connect(harmonicGain);
  gain.connect(ctx.destination);
  harmonicGain.connect(ctx.destination);

  osc.start(start);
  harmonic.start(start);
  osc.stop(start + duration + 0.02);
  harmonic.stop(start + duration + 0.02);
}

export async function playNotificationSound(kind: NotificationSoundKind) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(kind === "order" ? [140, 70, 180] : [120, 60, 120]);
    }

    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (kind === "order") {
      // Bright Grab/Gojek-like incoming order chime
      scheduleTone(ctx, 880, 0, 0.22, 0.38);
      scheduleTone(ctx, 1174.66, 0.14, 0.26, 0.4);
      scheduleTone(ctx, 1318.51, 0.28, 0.42, 0.42);
    } else if (kind === "session") {
      // Clear 3-note schedule bell
      scheduleTone(ctx, 659.25, 0, 0.22, 0.36);
      scheduleTone(ctx, 880, 0.16, 0.24, 0.38);
      scheduleTone(ctx, 1046.5, 0.32, 0.42, 0.4);
    } else {
      // Crisp 2-note payment / QRIS chime
      scheduleTone(ctx, 783.99, 0, 0.2, 0.38);
      scheduleTone(ctx, 1174.66, 0.14, 0.38, 0.42);
    }
  } catch {
    // Ignore autoplay errors if browser still blocks sound
  }
}

export function sendBrowserNotification(title: string, body: string) {
  try {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      new Notification(title, {
        body,
        icon: "/icon.svg",
      });
    }
  } catch {
    // Ignore browser notification errors
  }
}
