import { useState } from "react";
import { TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "./theme";

export type InputProps = TextInputProps & {
  icon?: keyof typeof Ionicons.glyphMap;
  right?: React.ReactNode;
  containerStyle?: ViewStyle;
};

export function Input({ icon, right, containerStyle, onFocus, onBlur, style, ...rest }: InputProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: t.colors.surfaceSunken,
          borderRadius: t.radius.md,
          paddingHorizontal: t.spacing.md,
          height: 48,
          borderWidth: 1.5,
          borderColor: focused ? t.colors.primary : "transparent",
        },
        containerStyle,
      ]}
    >
      {icon !== undefined && <Ionicons name={icon} size={19} color={t.colors.textTertiary} />}
      <TextInput
        placeholderTextColor={t.colors.textTertiary}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[{ flex: 1, fontSize: 17, color: t.colors.textPrimary, paddingVertical: 0 }, style]}
        {...rest}
      />
      {right}
    </View>
  );
}
