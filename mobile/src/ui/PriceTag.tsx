import { View } from "react-native";
import { useTheme } from "./theme";
import { Text } from "./Text";

// A money display. Splits dollars/cents for an Apple-receipt look; optional strike-through "was" price.
export function PriceTag({ value, size = "lg", tone = "primary", was }: { value: number; size?: "md" | "lg" | "xl"; tone?: "primary" | "default"; was?: number | null }) {
  const t = useTheme();
  const whole = Math.floor(value);
  const cents = Math.round((value - whole) * 100).toString().padStart(2, "0");
  const big = size === "xl" ? 40 : size === "lg" ? 30 : 22;
  const small = size === "xl" ? 20 : size === "lg" ? 16 : 13;
  const color = tone === "primary" ? t.colors.primary : t.colors.textPrimary;
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <Text style={{ fontSize: small, fontWeight: "700", color, marginTop: 2 }}>$</Text>
        <Text style={{ fontSize: big, fontWeight: "800", color, letterSpacing: -0.5 }}>{whole}</Text>
        <Text style={{ fontSize: small, fontWeight: "700", color, marginTop: 2 }}>.{cents}</Text>
      </View>
      {was != null && was > value && (
        <Text variant="footnote" tone="tertiary" style={{ textDecorationLine: "line-through" }}>${was.toFixed(2)}</Text>
      )}
    </View>
  );
}
