import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { useTheme, type TypeVariant } from "./theme";

type Tone = "primary" | "secondary" | "tertiary" | "brand" | "danger" | "success" | "onPrimary" | "inherit";

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  tone?: Tone;
  weight?: "400" | "500" | "600" | "700" | "800";
  center?: boolean;
};

export function Text({ variant = "body", tone = "primary", weight, center, style, ...rest }: TextProps) {
  const t = useTheme();
  const color =
    tone === "inherit" ? undefined
    : tone === "secondary" ? t.colors.textSecondary
    : tone === "tertiary" ? t.colors.textTertiary
    : tone === "brand" ? t.colors.primary
    : tone === "danger" ? t.colors.danger
    : tone === "success" ? t.colors.success
    : tone === "onPrimary" ? t.colors.onPrimary
    : t.colors.textPrimary;
  return (
    <RNText
      style={[t.typography[variant], color !== undefined && { color }, weight !== undefined && { fontWeight: weight }, center && { textAlign: "center" }, style]}
      {...rest}
    />
  );
}
