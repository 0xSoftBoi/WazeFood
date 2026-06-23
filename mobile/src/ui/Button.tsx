import { ActivityIndicator, Platform, Pressable, type PressableProps, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTheme } from "./theme";
import { Text } from "./Text";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export type ButtonProps = Omit<PressableProps, "style"> & {
  title: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  left?: React.ReactNode;
  style?: ViewStyle;
};

const HEIGHT: Record<Size, number> = { sm: 38, md: 48, lg: 56 };
const PAD: Record<Size, number> = { sm: 14, md: 18, lg: 22 };

export function Button({ title, variant = "primary", size = "md", loading, fullWidth, left, disabled, onPressIn, onPressOut, onPress, style, ...rest }: ButtonProps) {
  const t = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const bg =
    variant === "primary" ? t.colors.primary
    : variant === "danger" ? t.colors.danger
    : variant === "secondary" ? t.colors.surfaceSunken
    : "transparent";
  const fg = variant === "primary" || variant === "danger" ? t.colors.onPrimary : variant === "ghost" ? t.colors.primary : t.colors.textPrimary;
  const isDisabled = disabled === true || loading === true;

  return (
    <Animated.View style={[animatedStyle, fullWidth && { alignSelf: "stretch" }]}>
      <Pressable
        accessibilityRole="button"
        disabled={isDisabled}
        onPressIn={(e) => { scale.value = withTiming(0.97, { duration: 90 }); onPressIn?.(e); }}
        onPressOut={(e) => { scale.value = withTiming(1, { duration: 120 }); onPressOut?.(e); }}
        onPress={(e) => { if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress?.(e); }}
        style={[
          {
            height: HEIGHT[size],
            paddingHorizontal: PAD[size],
            borderRadius: t.radius.md,
            backgroundColor: bg,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            opacity: isDisabled ? 0.5 : 1,
          },
          variant === "ghost" && { borderWidth: 0 },
          style,
        ]}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <>
            {left}
            <Text variant={size === "lg" ? "headline" : "callout"} weight="600" style={{ color: fg }}>{title}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}
