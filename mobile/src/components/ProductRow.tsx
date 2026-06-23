import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Text, useTheme } from "../ui";
import type { Product } from "../api/client";

export function ProductRow({ product, onPress, right }: { product: Pick<Product, "id" | "name" | "brand" | "isStoreBrand">; onPress: () => void; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <Card onPress={onPress} elevation="sm" style={{ marginBottom: t.spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
        <View style={{ width: 44, height: 44, borderRadius: t.radius.md, backgroundColor: t.colors.primaryTint, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="pricetag" size={20} color={t.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="headline" numberOfLines={1}>{product.name}</Text>
          <Text variant="footnote" tone="secondary" numberOfLines={1}>
            {product.brand ?? "Generic"}{product.isStoreBrand ? " · Store brand" : ""}
          </Text>
        </View>
        {right ?? <Ionicons name="chevron-forward" size={18} color={t.colors.textTertiary} />}
      </View>
    </Card>
  );
}
