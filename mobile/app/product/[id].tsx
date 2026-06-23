import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Badge, Button, Card, PriceTag, Screen, Skeleton, Text, useTheme } from "../../src/ui";
import { ProductImage } from "../../src/components/ProductImage";
import { useSession } from "../../src/session";
import { confidencePct, km, prettyStore } from "../../src/lib/format";
import type { BestPrice } from "../../src/api/client";

export default function ProductDetailScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id, name, brand, image, category } = useLocalSearchParams<{ id: string; name?: string; brand?: string; image?: string; category?: string }>();
  const { api, userId, location, ensureList } = useSession();
  const [price, setPrice] = useState<BestPrice | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<"list" | "watch" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPrice(await api.bestPrice(id, location.lat, location.lng));
    } catch {
      setPrice({ found: false });
    } finally {
      setLoading(false);
    }
  }, [api, id, location]);

  useEffect(() => { void load(); }, [load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  const addToList = useCallback(async () => {
    if (userId == null) return;
    setBusy("list");
    try {
      const listId = await ensureList();
      await api.addListItem(listId, userId, id, 1);
      flash("Added to your list");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(null);
    }
  }, [api, ensureList, id, userId]);

  const watch = useCallback(async () => {
    if (userId == null) return;
    setBusy("watch");
    try {
      await api.addWatch(userId, id, location.lat, location.lng);
      flash("We'll alert you when it drops");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not watch");
    } finally {
      setBusy(null);
    }
  }, [api, id, location, userId]);

  const found = price?.found === true;

  return (
    <Screen grouped>
      <Stack.Screen options={{ title: name ?? "Product" }} />

      <View style={{ alignItems: "center", paddingVertical: t.spacing.lg }}>
        <ProductImage uri={image} category={category} size={160} width={160} radius={t.radius.xl} />
      </View>
      <View style={{ paddingBottom: t.spacing.base, gap: 4 }}>
        <Text variant="title1">{name ?? "Product"}</Text>
        {brand != null && brand.length > 0 && <Text variant="callout" tone="secondary">{brand}</Text>}
      </View>

      <Card elevation="md" style={{ marginBottom: t.spacing.base }}>
        {loading ? (
          <View style={{ gap: t.spacing.sm }}>
            <Skeleton width={140} height={36} />
            <Skeleton width={180} height={16} />
          </View>
        ) : found ? (
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="footnote" tone="secondary">Best nearby price</Text>
            <PriceTag value={price!.price!} size="xl" />
            <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm, marginTop: 2 }}>
              <Ionicons name="storefront" size={16} color={t.colors.textSecondary} />
              <Text variant="callout" tone="secondary">{prettyStore(price!.storeId)} · {km(price!.distanceMeters)}</Text>
            </View>
            <Badge label={`${confidencePct(price!.confidence)}% confidence`} tone="success" />
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <Text variant="headline">No price yet</Text>
            <Text variant="subhead" tone="secondary">Be the first to report a price here and earn karma.</Text>
          </View>
        )}
      </Card>

      <View style={{ gap: t.spacing.sm }}>
        <Button title="Add to list" left={<Ionicons name="add" size={20} color={t.colors.onPrimary} />} loading={busy === "list"} onPress={addToList} fullWidth />
        <Button title="Watch price" variant="secondary" left={<Ionicons name="notifications-outline" size={18} color={t.colors.textPrimary} />} loading={busy === "watch"} onPress={watch} fullWidth />
        <Button
          title={found ? "Report a different price" : "Report a price"}
          variant="ghost"
          left={<Ionicons name="add-circle-outline" size={18} color={t.colors.primary} />}
          onPress={() => router.push({ pathname: "/report/[productId]", params: { productId: id, name: name ?? "" } })}
          fullWidth
        />
      </View>

      {toast != null && (
        <Card elevation="lg" style={{ marginTop: t.spacing.lg, backgroundColor: t.colors.primaryTint }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
            <Ionicons name="checkmark-circle" size={20} color={t.colors.primary} />
            <Text variant="callout" tone="brand" weight="600">{toast}</Text>
          </View>
        </Card>
      )}
    </Screen>
  );
}
