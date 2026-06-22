import { ScrollView, View, RefreshControl, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useTheme } from "./theme";

export type ScreenProps = {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  grouped?: boolean; // grouped background (iOS settings-style) vs plain
  edges?: Edge[];
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: ViewStyle;
};

export function Screen({ children, scroll = true, padded = true, grouped = false, edges = ["top"], onRefresh, refreshing, contentStyle }: ScreenProps) {
  const t = useTheme();
  const bg = grouped ? t.colors.bgSubtle : t.colors.bg;
  const pad: ViewStyle = padded ? { paddingHorizontal: t.spacing.base } : {};

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ paddingBottom: t.spacing.xxxl }, pad, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={t.colors.textTertiary} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: bg }}>
      {body}
    </SafeAreaView>
  );
}
