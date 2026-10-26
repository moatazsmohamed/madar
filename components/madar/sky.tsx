import { Platform, StyleSheet, View } from "react-native";
import { useThemeContext } from "@/lib/theme-provider";
import { Icon, useIsWide, type IconName } from "./ui";

export type SkyScene = "dawn" | "day" | "dusk" | "night";

/** The decorative sky follows the Cairo clock, not the manual theme toggle. */
export function skyScene(colorScheme: "light" | "dark", hour: number): SkyScene {
  if (colorScheme === "dark") return "night";
  if (hour >= 22 || hour < 4) return "dusk";
  if (hour < 10) return "dawn";
  if (hour < 16) return "day";
  return "dusk";
}

type Figure = {
  icon: IconName;
  left: `${number}%`;
  top: `${number}%`;
  size: number;
  color: string;
  opacity: number;
};

type Star = { left: `${number}%`; top: `${number}%`; size: number; opacity: number };

type SceneSetup = {
  wash: string;
  nativeTint: string;
  glow?: { left: `${number}%`; top: `${number}%`; size: number; color: string };
  main: Figure;
  companion?: Figure;
  clouds: Figure[];
  stars: Star[];
};

const SCENES: Record<SkyScene, SceneSetup> = {
  dawn: {
    wash: "linear-gradient(180deg, rgba(247,171,92,0.30) 0%, rgba(255,219,168,0.16) 42%, rgba(247,244,236,0) 78%)",
    nativeTint: "rgba(247,171,92,0.16)",
    glow: { left: "-4%", top: "-6%", size: 300, color: "rgba(255,196,120,0.30)" },
    main: { icon: "sunrise", left: "5%", top: "8%", size: 178, color: "#F0A44B", opacity: 0.3 },
    clouds: [
      { icon: "cloud", left: "28%", top: "4%", size: 108, color: "#D9B98C", opacity: 0.35 },
      { icon: "cloud", left: "58%", top: "17%", size: 76, color: "#D9B98C", opacity: 0.28 },
    ],
    stars: [],
  },
  day: {
    wash: "linear-gradient(180deg, rgba(116,186,226,0.22) 0%, rgba(214,237,248,0.13) 45%, rgba(247,244,236,0) 80%)",
    nativeTint: "rgba(116,186,226,0.14)",
    glow: { left: "-3%", top: "-8%", size: 320, color: "rgba(255,214,120,0.26)" },
    main: { icon: "sun", left: "6%", top: "5%", size: 196, color: "#E5B541", opacity: 0.26 },
    clouds: [
      { icon: "cloud", left: "30%", top: "6%", size: 118, color: "#8FB9CE", opacity: 0.24 },
      { icon: "cloud", left: "62%", top: "19%", size: 82, color: "#8FB9CE", opacity: 0.18 },
    ],
    stars: [],
  },
  dusk: {
    wash: "linear-gradient(180deg, rgba(238,145,110,0.26) 0%, rgba(201,144,186,0.16) 48%, rgba(247,244,236,0) 82%)",
    nativeTint: "rgba(238,145,110,0.16)",
    glow: { left: "-2%", top: "38%", size: 280, color: "rgba(240,140,96,0.20)" },
    main: { icon: "sunset", left: "5%", top: "11%", size: 174, color: "#E0784F", opacity: 0.3 },
    companion: { icon: "moon", left: "35%", top: "6%", size: 86, color: "#C9BBDD", opacity: 0.4 },
    clouds: [
      { icon: "cloud", left: "24%", top: "24%", size: 104, color: "#C08C9B", opacity: 0.28 },
      { icon: "cloud", left: "60%", top: "12%", size: 72, color: "#C08C9B", opacity: 0.2 },
    ],
    stars: [
      { left: "48%", top: "9%", size: 4, opacity: 0.45 },
      { left: "57%", top: "20%", size: 3, opacity: 0.35 },
      { left: "68%", top: "8%", size: 3, opacity: 0.4 },
    ],
  },
  night: {
    wash: "linear-gradient(180deg, rgba(46,92,120,0.40) 0%, rgba(27,56,49,0.24) 48%, rgba(16,24,20,0) 86%)",
    nativeTint: "rgba(46,92,120,0.20)",
    glow: { left: "-3%", top: "-5%", size: 280, color: "rgba(220,231,222,0.10)" },
    main: { icon: "moon", left: "6%", top: "7%", size: 152, color: "#E9DFBE", opacity: 0.35 },
    clouds: [
      { icon: "cloud", left: "31%", top: "21%", size: 116, color: "#8BA396", opacity: 0.12 },
      { icon: "cloud", left: "63%", top: "9%", size: 78, color: "#8BA396", opacity: 0.09 },
    ],
    stars: [
      { left: "28%", top: "7%", size: 4, opacity: 0.5 },
      { left: "38%", top: "16%", size: 3, opacity: 0.4 },
      { left: "48%", top: "5%", size: 3, opacity: 0.45 },
      { left: "55%", top: "14%", size: 5, opacity: 0.35 },
      { left: "19%", top: "26%", size: 3, opacity: 0.3 },
      { left: "44%", top: "30%", size: 3, opacity: 0.3 },
      { left: "66%", top: "24%", size: 4, opacity: 0.35 },
      { left: "73%", top: "6%", size: 3, opacity: 0.3 },
    ],
  },
};

/** Soft sun / moon scenery painted behind the app surfaces. */
export function SkyBackdrop() {
  const { colorScheme, hour } = useThemeContext();
  const wide = useIsWide(900);
  const scale = wide ? 1 : 0.58;
  const scene = SCENES[skyScene(colorScheme, hour)];

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <View
        style={[
          StyleSheet.absoluteFill,
          Platform.OS === "web" ? ({ backgroundImage: scene.wash } as object) : { backgroundColor: scene.nativeTint },
        ]}
      />
      {scene.glow ? (
        <View
          style={{
            position: "absolute",
            left: scene.glow.left,
            top: scene.glow.top,
            width: scene.glow.size * scale,
            height: scene.glow.size * scale,
            borderRadius: (scene.glow.size * scale) / 2,
            backgroundColor: scene.glow.color,
          }}
        />
      ) : null}
      <Icon
        name={scene.main.icon}
        size={Math.round(scene.main.size * scale)}
        color={scene.main.color}
        style={{ position: "absolute", left: scene.main.left, top: scene.main.top, opacity: scene.main.opacity }}
      />
      {scene.companion ? (
        <Icon
          name={scene.companion.icon}
          size={Math.round(scene.companion.size * scale)}
          color={scene.companion.color}
          style={{
            position: "absolute",
            left: scene.companion.left,
            top: scene.companion.top,
            opacity: scene.companion.opacity,
          }}
        />
      ) : null}
      {scene.clouds.map((cloud) => (
        <Icon
          key={`${cloud.icon}-${cloud.left}`}
          name={cloud.icon}
          size={Math.round(cloud.size * scale)}
          color={cloud.color}
          style={{ position: "absolute", left: cloud.left, top: cloud.top, opacity: cloud.opacity }}
        />
      ))}
      {scene.stars.map((star) => (
        <View
          key={`${star.left}-${star.top}`}
          style={{
            position: "absolute",
            left: star.left,
            top: star.top,
            width: star.size,
            height: star.size,
            borderRadius: star.size / 2,
            backgroundColor: "#E9F1E9",
            opacity: star.opacity,
          }}
        />
      ))}
    </View>
  );
}
