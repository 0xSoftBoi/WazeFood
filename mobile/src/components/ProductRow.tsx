import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Text, useTheme } from "../ui";
import { ProductImage } from "./ProductImage";
import type { Product } from "../api/client";

export function ProductRow({ product, onPress, right }: { product: Pick<Product, "id" | "name" | "brand" | "isStoreBrand" | "category" | "imageUrl">; onPress: () => void; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <Card onPress={onPress} elevation="sm" style={{ marginBottom: t.spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
        <ProductImage uri={product.imageUrl} category={product.category} size={52} />
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
