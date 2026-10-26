import { Pressable } from "react-native";
import { useThemeContext } from "@/lib/theme-provider";
import { C, Icon, T } from "./ui";

/**
 * Manual light/dark switch shown at the top of the shell. It pins the choice;
 * «تلقائي» in Settings hands control back to the Cairo schedule.
 */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { colorScheme, setPreference } = useThemeContext();
  const dark = colorScheme === "dark";
  const next = dark ? "light" : "dark";
  const label = dark ? "نهاري" : "ليلي";
  const accessibilityLabel = dark ? "التحويل إلى الوضع النهاري" : "التحويل إلى الوضع الليلي";

  return (
    <Pressable
      onPress={() => setPreference(next)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        height: compact ? 34 : 32,
        width: compact ? 34 : undefined,
        paddingHorizontal: compact ? 0 : 10,
        borderRadius: compact ? 11 : 999,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: pressed ? C.sand : C.surface,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      })}
    >
      <Icon name={dark ? "sun" : "moon"} size={compact ? 16 : 14} color={C.primary} />
      {compact ? null : (
        <T weight="semibold" style={{ fontSize: 11.5, color: C.foreground }}>
          {label}
        </T>
      )}
    </Pressable>
  );
}
