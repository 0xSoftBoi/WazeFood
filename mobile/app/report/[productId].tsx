// Crowdsource a price. Pick a nearby store, enter the price you saw (or attach a receipt/shelf
// photo), and submit a contribution — the input side of the data graph. A stable idempotency key
// makes a retried submit safe.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Badge, Button, Card, Screen, Skeleton, Text, useTheme } from "../../src/ui";
import { useSession } from "../../src/session";
import { km } from "../../src/lib/format";
import type { StoreNear } from "../../src/api/client";

export default function ReportScreen() {
  const t = useTheme();
  const router = useRouter();
  const { productId, name } = useLocalSearchParams<{ productId: string; name?: string }>();
  const { api, userId, location } = useSession();
  const [stores, setStores] = useState<StoreNear[] | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [photo, setPhoto] = useState<{ base64: string; mediaType: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A stable key for this report attempt so a retry doesn't double-count.
  const idempotencyKey = useMemo(() => `rpt-${productId}-${Math.random().toString(36).slice(2)}`, [productId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.storesNear(location.lat, location.lng);
        setStores(res.stores);
        if (res.stores[0] != null) setStoreId(res.stores[0].id);
      } catch {
        setStores([]);
      }
    })();
  }, [api, location]);

  const pickPhoto = useCallback(async () => {
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5, allowsEditing: true });
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset?.base64 != null) setPhoto({ base64: asset.base64, mediaType: asset.mimeType ?? "image/jpeg" });
  }, []);

  const priceNum = Number(price);
  const canSubmit = storeId != null && userId != null && (Number.isFinite(priceNum) && priceNum > 0 || photo != null);

  const submit = useCallback(async () => {
    if (!canSubmit || storeId == null || userId == null) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.contribute({
        idempotencyKey,
        userId,
        storeId,
        kind: photo != null ? "receipt" : "price",
        productId,
        reportedPrice: Number.isFinite(priceNum) && priceNum > 0 ? Math.round(priceNum * 100) / 100 : null,
        image: photo != null ? { base64: photo.base64, mediaType: photo.mediaType } : null,
        lat: location.lat,
        lng: location.lng,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }, [api, canSubmit, idempotencyKey, location, photo, priceNum, productId, storeId, userId]);

  if (done) {
    return (
      <Screen grouped>
        <Stack.Screen options={{ title: "Report a price" }} />
        <View style={{ alignItems: "center", paddingVertical: t.spacing.xxxl, gap: t.spacing.base }}>
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: t.colors.primaryTint, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="checkmark" size={44} color={t.colors.primary} />
          </View>
          <Text variant="title2">Thanks!</Text>
          <Text variant="subhead" tone="secondary" center>Your report helps everyone nearby pay less — you earned karma.</Text>
          <Button title="Done" onPress={() => router.back()} style={{ marginTop: t.spacing.base }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen grouped>
      <Stack.Screen options={{ title: "Report a price" }} />
      <View style={{ paddingVertical: t.spacing.base }}>
        <Text variant="title2">{name ?? "Report a price"}</Text>
        <Text variant="subhead" tone="secondary">Where did you see it, and for how much?</Text>
      </View>

      <Text variant="footnote" tone="secondary" style={{ marginBottom: t.spacing.sm }}>STORE</Text>
      {stores === null ? (
        <View style={{ gap: t.spacing.sm }}>{[0, 1].map((i) => <Skeleton key={i} height={56} radius={t.radius.lg} />)}</View>
      ) : stores.length === 0 ? (
        <Text variant="subhead" tone="secondary">No stores near you yet.</Text>
      ) : (
        stores.map((s) => (
          <Card key={s.id} onPress={() => setStoreId(s.id)} elevation="sm" style={[{ marginBottom: t.spacing.sm }, storeId === s.id && { borderColor: t.colors.primary, borderWidth: 1.5 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
              <Ionicons name={storeId === s.id ? "radio-button-on" : "radio-button-off"} size={22} color={storeId === s.id ? t.colors.primary : t.colors.textTertiary} />
              <View style={{ flex: 1 }}>
                <Text variant="headline">{s.name}</Text>
                <Text variant="footnote" tone="secondary">{km(s.distanceMeters)} away</Text>
              </View>
            </View>
          </Card>
        ))
      )}

      <Text variant="footnote" tone="secondary" style={{ marginTop: t.spacing.lg, marginBottom: t.spacing.sm }}>PRICE</Text>
      <Card elevation="sm">
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
          <Text variant="title2" tone="secondary">$</Text>
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="0.00"
            placeholderTextColor={t.colors.textTertiary}
            keyboardType="decimal-pad"
            style={{ flex: 1, fontSize: 28, fontWeight: "700", color: t.colors.textPrimary, paddingVertical: 0 }}
          />
        </View>
      </Card>

      <Pressable onPress={pickPhoto} style={{ marginTop: t.spacing.base }}>
        <Card elevation="sm">
          <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
            {photo != null ? (
              <Image source={{ uri: `data:${photo.mediaType};base64,${photo.base64}` }} style={{ width: 44, height: 44, borderRadius: t.radius.sm }} />
            ) : (
              <View style={{ width: 44, height: 44, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="camera" size={22} color={t.colors.textSecondary} />
              </View>
            )}
            <Text variant="callout" weight="600" style={{ flex: 1 }}>{photo != null ? "Photo attached" : "Attach a receipt or shelf photo"}</Text>
            {photo != null && <Badge label="Optional" />}
          </View>
        </Card>
      </Pressable>

      {error != null && <Text variant="footnote" tone="danger" style={{ marginTop: t.spacing.md }}>{error}</Text>}

      <Button
        title="Submit report"
        loading={submitting}
        disabled={!canSubmit}
        onPress={submit}
        fullWidth
        style={{ marginTop: t.spacing.xl }}
      />
    </Screen>
  );
}
