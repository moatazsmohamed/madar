import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { colorScheme as nativewindColorScheme, vars } from "nativewind";
import { SchemeColors, type ColorScheme } from "@/constants/theme";

export type ThemePreference = "auto" | "light" | "dark";

export const NIGHT_START_HOUR = 16;
export const NIGHT_END_HOUR = 6;

const STORAGE_KEY = "madar.theme";
const CAIRO_TZ = "Africa/Cairo";

type ThemeContextValue = {
  colorScheme: ColorScheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  colorScheme: "light",
  preference: "auto",
  setPreference: () => {},
});

/** Hour (0-23) in Cairo, where the night schedule is defined. */
export function cairoHour(date = new Date()): number {
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: CAIRO_TZ,
      hourCycle: "h23",
      hour: "2-digit",
    }).format(date);
    return Number(hour) % 24;
  } catch {
    return date.getHours();
  }
}

/** Night mode runs from 4 PM until 6 AM Cairo time. */
export function isNightHour(hour: number) {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

function readPreference(): ThemePreference {
  if (Platform.OS !== "web" || typeof window === "undefined") return "auto";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "auto" || stored === "light" || stored === "dark") return stored;
  } catch {
    // storage can be blocked; fall back to the schedule
  }
  return "auto";
}

// The palette is applied as CSS variables on web and NativeWind variables on
// native. Web follows the light/dark palettes; native keeps the light one.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [hour, setHour] = useState(() => cairoHour());

  useEffect(() => {
    const tick = () => setHour(cairoHour());
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore: storage can be blocked
      }
    }
  }, []);

  const wanted: ColorScheme = preference === "auto" ? (isNightHour(hour) ? "dark" : "light") : preference;
  const colorScheme: ColorScheme = Platform.OS === "web" ? wanted : "light";
  const palette = SchemeColors[colorScheme];

  useEffect(() => {
    try {
      nativewindColorScheme.set(colorScheme);
    } catch {
      // ignore: unsupported on some platforms
    }
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.dataset.theme = colorScheme;
      root.style.colorScheme = colorScheme;
      root.lang = "ar";
      root.dir = "rtl";
      Object.entries(palette).forEach(([token, value]) => {
        root.style.setProperty(`--color-${token}`, value);
      });
    }
  }, [colorScheme, palette]);

  const themeVariables = useMemo(
    () =>
      vars(
        Object.fromEntries(Object.entries(palette).map(([token, value]) => [`color-${token}`, value])),
      ),
    [palette],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ colorScheme, preference, setPreference }),
    [colorScheme, preference, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, themeVariables]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  return useContext(ThemeContext);
}
