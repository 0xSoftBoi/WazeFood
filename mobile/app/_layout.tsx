import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../src/session";

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: "#0f766e" }, headerTintColor: "#fff" }}>
        <Stack.Screen name="index" options={{ title: "SmartCart" }} />
      </Stack>
    </SessionProvider>
  );
}
