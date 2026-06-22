import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "./theme";
import { Text } from "./Text";

export function EmptyState({ icon, title, subtitle, action }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string; action?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: t.spacing.xxxl, paddingHorizontal: t.spacing.xl, gap: t.spacing.md }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: t.colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={32} color={t.colors.textTertiary} />
      </View>
      <Text variant="headline" center>{title}</Text>
      {subtitle !== undefined && <Text variant="subhead" tone="secondary" center>{subtitle}</Text>}
      {action !== undefined && <View style={{ marginTop: t.spacing.sm }}>{action}</View>}
    </View>
  );
}
