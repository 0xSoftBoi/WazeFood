// A product thumbnail: the real photo (cached, with a fade-in) when we have one, else a designed
// gradient tile with a category emoji — so every product looks intentional, never a broken image.

import { useState } from "react";
import { Text, View, type DimensionValue } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../ui";

const CATEGORY: Record<string, { colors: [string, string]; emoji: string }> = {
  dairy: { colors: ["#BFDBFE", "#60A5FA"], emoji: "🥛" },
  bakery: { colors: ["#FCD9A8", "#E0A867"], emoji: "🍞" },
  produce: { colors: ["#BBF7D0", "#34D399"], emoji: "🥬" },
  beverage: { colors: ["#A7F3D0", "#2DD4BF"], emoji: "🥤" },
  snack: { colors: ["#FDE68A", "#F59E0B"], emoji: "🍿" },
  pantry: { colors: ["#FECACA", "#F87171"], emoji: "🥫" },
  breakfast: { colors: ["#FED7AA", "#FB923C"], emoji: "🥣" },
  household: { colors: ["#C7D2FE", "#818CF8"], emoji: "🧻" },
  meat: { colors: ["#FCA5A5", "#EF4444"], emoji: "🍗" },
};
const FALLBACK = { colors: ["#CFFAE6", "#6EE7B7"] as [string, string], emoji: "🛒" };

export function ProductImage({
  uri,
  category,
  size = 56,
  radius,
  width,
}: {
  uri?: string | null;
  category?: string | null;
  size?: number;
  radius?: number;
  width?: DimensionValue;
}) {
  const t = useTheme();
  const [errored, setErrored] = useState(false);
  const r = radius ?? t.radius.md;
  const w = width ?? size;
  const cat = CATEGORY[category ?? ""] ?? FALLBACK;

  if (uri != null && uri.length > 0 && !errored) {
    return (
      <View style={{ width: w, height: size, borderRadius: r, overflow: "hidden", backgroundColor: "#FFFFFF" }}>
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
          transition={160}
          onError={() => setErrored(true)}
        />
      </View>
    );
  }
  return (
    <LinearGradient colors={cat.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: w, height: size, borderRadius: r, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.42 }}>{cat.emoji}</Text>
    </LinearGradient>
  );
}
