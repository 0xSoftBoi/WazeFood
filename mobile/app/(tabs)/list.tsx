import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Badge, Button, Card, EmptyState, PriceTag, Screen, Skeleton, Text, useTheme } from "../../src/ui";
import { ProductImage } from "../../src/components/ProductImage";
import { useSession } from "../../src/session";
import { prettyStore } from "../../src/lib/format";
import type { CartPlan, PricedList } from "../../src/api/client";

export default function ListScreen() {
  const t = useTheme();
  const router = useRouter();
  const { api, userId, location, ensureList } = useSession();
  const [list, setList] = useState<PricedList | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<CartPlan | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  const load = useCallback(async () => {
    try {
      const listId = await ensureList();
      setList(await api.pricedList(listId, location.lat, location.lng));
    } catch {
      setList(null);
    } finally {
      setLoading(false);
    }
  }, [api, ensureList, location]);

  useFocusEffect(useCallback(() => { setLoading(true); void load(); }, [load]));

  const optimize = useCallback(async () => {
    if (userId == null || list == null) return;
    setOptimizing(true);
    try {
      const result = await api.optimize({
        userId,
        items: list.items.map((i) => ({ productId: i.productId, qty: i.qty })),
        lat: location.lat,
        lng: location.lng,
        mode: "balanced",
      });
      setPlan(result);
    } catch {
      /* surfaced as no-plan */
    } finally {
      setOptimizing(false);
    }
  }, [api, list, location, userId]);

  const empty = list != null && list.items.length === 0;

  return (
    <Screen grouped>
      <Text variant="largeTitle" style={{ paddingVertical: t.spacing.base }}>Your list</Text>

      {loading ? (
        <View style={{ gap: t.spacing.sm }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={64} radius={t.radius.lg} />)}</View>
      ) : empty ? (
        <EmptyState
          icon="cart-outline"
          title="Your list is empty"
          subtitle="Search for groceries and tap Add to list."
          action={<Button title="Find groceries" onPress={() => router.push("/")} />}
        />
      ) : list != null ? (
        <>
          {list.items.map((item) => (
            <Card key={item.id} elevation="sm" style={{ marginBottom: t.spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
                <ProductImage uri={item.imageUrl} category={item.category} size={46} />
                <View style={{ flex: 1 }}>
                  <Text variant="headline" numberOfLines={1}>{item.name}</Text>
                  <Text variant="footnote" tone="secondary">
                    {item.qty > 1 ? `${item.qty} × ` : ""}{item.best != null ? prettyStore(item.best.storeId) : "No price nearby"}
                  </Text>
                </View>
                {item.best != null ? <PriceTag value={item.lineTotal ?? item.best.price ?? 0} size="md" tone="default" /> : <Badge label="—" />}
              </View>
            </Card>
          ))}

          <Card elevation="md" style={{ marginTop: t.spacing.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View>
                <Text variant="footnote" tone="secondary">Estimated total</Text>
                <Text variant="caption" tone="tertiary">{list.pricedCount}/{list.itemCount} items priced</Text>
              </View>
              <PriceTag value={list.total} size="lg" tone="default" />
            </View>
          </Card>

          {plan != null && plan.estimatedSavings! > 0 && (
            <Card elevation="md" style={{ marginTop: t.spacing.base, backgroundColor: t.colors.primaryTint }}>
              <Text variant="footnote" tone="brand" weight="600">SMARTCART PLAN · {String(plan.mode).toUpperCase()}</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                <Text variant="title1" tone="brand">Save ${plan.estimatedSavings!.toFixed(2)}</Text>
              </View>
              <Text variant="subhead" tone="secondary" style={{ marginTop: 2 }}>
                ${plan.baselineCost?.toFixed(2)} → ${plan.optimizedCost?.toFixed(2)} across {plan.stores?.length ?? 1} store{(plan.stores?.length ?? 1) > 1 ? "s" : ""}
              </Text>
            </Card>
          )}

          <Button
            title={plan != null ? "Re-optimize" : "Optimize my trip"}
            left={<Ionicons name="sparkles" size={18} color={t.colors.onPrimary} />}
            loading={optimizing}
            onPress={optimize}
            fullWidth
            style={{ marginTop: t.spacing.base }}
          />
        </>
      ) : (
        <EmptyState icon="alert-circle-outline" title="Couldn't load your list" action={<Button title="Retry" variant="secondary" onPress={() => { setLoading(true); void load(); }} />} />
      )}
    </Screen>
  );
}
