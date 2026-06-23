import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, EmptyState, Screen, Skeleton, Text, useTheme } from "../../src/ui";
import { StoreMap } from "../../src/components/StoreMap";
import { useSession } from "../../src/session";
import { km } from "../../src/lib/format";
import type { StoreNear } from "../../src/api/client";

export default function NearbyScreen() {
  const t = useTheme();
  const { api, location } = useSession();
  const [stores, setStores] = useState<StoreNear[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.storesNear(location.lat, location.lng);
      setStores(res.stores);
    } catch {
      setStores([]);
    }
  }, [api, location]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen grouped refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <Text variant="largeTitle" style={{ paddingVertical: t.spacing.base }}>Nearby</Text>

      {stores === null ? (
        <Skeleton height={340} radius={t.radius.lg} />
      ) : (
        <StoreMap center={location} stores={stores} height={340} />
      )}

      <Text variant="title3" style={{ marginTop: t.spacing.lg, marginBottom: t.spacing.md }}>Stores near you</Text>

      {stores === null ? (
        <View style={{ gap: t.spacing.sm }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={64} radius={t.radius.lg} />)}</View>
      ) : stores.length === 0 ? (
        <EmptyState icon="storefront-outline" title="No stores nearby" subtitle="We don't have stores mapped at your location yet." />
      ) : (
        stores.map((s) => (
          <Card key={s.id} elevation="sm" style={{ marginBottom: t.spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
              <View style={{ width: 44, height: 44, borderRadius: t.radius.md, backgroundColor: t.colors.primaryTint, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="storefront" size={20} color={t.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="headline" numberOfLines={1}>{s.name}</Text>
                <Text variant="footnote" tone="secondary">{s.retailer}</Text>
              </View>
              <Text variant="subhead" tone="secondary">{km(s.distanceMeters)}</Text>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
