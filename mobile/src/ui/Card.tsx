import { Pressable, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useTheme, type Elevation } from "./theme";

export type CardProps = ViewProps & {
  elevation?: Elevation;
  padded?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function Card({ elevation = "sm", padded = true, onPress, style, children, ...rest }: CardProps) {
  const t = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const base: ViewStyle = {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: padded ? t.spacing.base : 0,
    borderWidth: t.scheme === "dark" ? 1 : 0,
    borderColor: t.colors.border,
    ...t.shadow(elevation),
  };

  if (onPress === undefined) {
    return (
      <View style={[base, style]} {...rest}>
        {children}
      </View>
    );
  }
  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPressIn={() => { scale.value = withTiming(0.985, { duration: 90 }); }}
        onPressOut={() => { scale.value = withTiming(1, { duration: 130 }); }}
        onPress={onPress}
        style={[base, style]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
