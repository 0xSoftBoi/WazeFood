// Web fallback for StoreMap. react-native-maps has no web build, so on the web target we render a
// branded placeholder instead of importing it (keeps the web bundle clean). The Nearby screen still
// lists every store below, so web users get the same data — just without the interactive map.

import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Text, useTheme } from "../ui";
import type { StoreNear } from "../api/client";

export type StoreMapProps = {
  center: { lat: number; lng: number };
  stores: StoreNear[];
  height?: number;
  onSelectStore?: (id: string) => void;
};

export function StoreMap({ stores, height = 340 }: StoreMapProps) {
  const t = useTheme();
  return (
    <View style={{ height, borderRadius: t.radius.lg, overflow: "hidden" }}>
      <LinearGradient colors={["#13C683", "#04794F"]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 }}>
        <Ionicons name="map" size={40} color="#ffffff" />
        <Text variant="headline" style={{ color: "#fff" }} center>{stores.length} store{stores.length === 1 ? "" : "s"} near you</Text>
        <Text variant="footnote" style={{ color: "rgba(255,255,255,0.85)" }} center>The interactive map is available in the iOS and Android app.</Text>
      </LinearGradient>
    </View>
  );
}
