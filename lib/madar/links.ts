import { Platform, Share } from "react-native";

const FALLBACK_ORIGIN = "https://madar-three-liart.vercel.app";

export function appOrigin() {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return (process.env.EXPO_PUBLIC_APP_URL ?? FALLBACK_ORIGIN).replace(/\/+$/, "");
}

export function joinUrl(code: string) {
  return `${appOrigin()}/join/${code}`;
}

/** Copies on web; falls back to the native share sheet elsewhere. */
export async function copyText(value: string) {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  await Share.share({ message: value });
  return false;
}
