import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider, useTheme } from "../src/ui";
import { SessionProvider } from "../src/session";

function Navigator() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.bg },
        headerTintColor: t.colors.primary,
        headerTitleStyle: { color: t.colors.textPrimary },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="product/[id]" options={{ title: "", headerBackTitle: "Back", presentation: "card" }} />
      <Stack.Screen name="report/[productId]" options={{ title: "Report a price", presentation: "modal" }} />
      <Stack.Screen name="r/[token]" options={{ title: "", headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <StatusBar style="auto" />
            <Navigator />
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
