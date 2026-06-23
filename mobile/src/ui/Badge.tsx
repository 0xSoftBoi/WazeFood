import { View, type ViewStyle } from "react-native";
import { useTheme } from "./theme";
import { Text } from "./Text";

type Tone = "brand" | "neutral" | "success" | "warning" | "danger";

export function Badge({ label, tone = "neutral", style }: { label: string; tone?: Tone; style?: ViewStyle }) {
  const t = useTheme();
  const map: Record<Tone, { bg: string; fg: string }> = {
    brand: { bg: t.colors.primaryTint, fg: t.colors.primary },
    neutral: { bg: t.colors.surfaceSunken, fg: t.colors.textSecondary },
    success: { bg: t.colors.primaryTint, fg: t.colors.success },
    warning: { bg: "rgba(217,119,6,0.14)", fg: t.colors.warning },
    danger: { bg: "rgba(220,38,38,0.12)", fg: t.colors.danger },
  };
  const c = map[tone];
  return (
    <View style={[{ backgroundColor: c.bg, paddingHorizontal: 9, paddingVertical: 4, borderRadius: t.radius.pill, alignSelf: "flex-start" }, style]}>
      <Text variant="caption" weight="600" style={{ color: c.fg }}>{label}</Text>
    </View>
  );
}
