import { useEffect } from "react";
import { type ViewStyle, type DimensionValue } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { useTheme } from "./theme";

// A shimmering placeholder block for loading states (pulses opacity).
export function Skeleton({ width = "100%", height = 16, radius, style }: { width?: DimensionValue; height?: number; radius?: number; style?: ViewStyle }) {
  const t = useTheme();
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius ?? t.radius.sm, backgroundColor: t.colors.surfaceSunken },
        animated,
        style,
      ]}
    />
  );
}
