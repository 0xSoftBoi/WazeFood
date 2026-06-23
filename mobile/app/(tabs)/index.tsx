import { useCallback, useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Badge, Card, EmptyState, Screen, Skeleton, Text, useTheme } from "../../src/ui";
import { ProductRow } from "../../src/components/ProductRow";
import { useSession } from "../../src/session";
import { dealLabel, prettyStore } from "../../src/lib/format";
import type { Deal, Product } from "../../src/api/client";

const QUICK = ["milk", "eggs", "bread", "coffee"];

export default function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const { api, location, ready } = useSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadDeals = useCallback(async () => {
    try {
      const res = await api.dealsNear(location.lat, location.lng);
      setDeals(res.deals);
    } catch {
      setDeals([]);
    }
  }, [api, location]);

  useEffect(() => { if (ready) void loadDeals(); }, [ready, loadDeals]);

  const runSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (q.trim().length === 0) { setResults(null); return; }
    setSearching(true);
    try {
      const res = await api.search(q);
      setResults(res.results);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [api]);

  return (
    <Screen grouped refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadDeals(); setRefreshing(false); }}>
      <View style={{ paddingTop: t.spacing.sm, paddingBottom: t.spacing.base }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="location" size={13} color={t.colors.textSecondary} />
          <Text variant="footnote" tone="secondary">{location.source === "device" ? "Near you" : "New York · demo"}</Text>
        </View>
        <Text variant="largeTitle">Stop overpaying.</Text>
      </View>

      <Card padded={false} elevation="md" style={{ marginBottom: t.spacing.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: t.spacing.base, height: 52 }}>
          <Ionicons name="search" size={20} color={t.colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={runSearch}
            placeholder="Search groceries"
            placeholderTextColor={t.colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={{ flex: 1, fontSize: 17, color: t.colors.textPrimary, paddingVertical: 0 }}
          />
          {query.length > 0 && (
            <Pressable onPress={() => runSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={t.colors.textTertiary} />
            </Pressable>
          )}
        </View>
      </Card>

      {results === null ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm, marginBottom: t.spacing.xl }}>
            {QUICK.map((q) => (
              <Pressable key={q} onPress={() => runSearch(q)}>
                <Badge label={q} tone="brand" />
              </Pressable>
            ))}
          </View>

          <Text variant="title3" style={{ marginBottom: t.spacing.md }}>Deals near you</Text>
          {deals === null ? (
            <View style={{ gap: t.spacing.sm }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={68} radius={t.radius.lg} />)}</View>
          ) : deals.length === 0 ? (
            <EmptyState icon="sparkles-outline" title="No deals yet" subtitle="Be the first to report a price — pull to refresh." />
          ) : (
            deals.slice(0, 12).map((d) => <DealCard key={d.id} deal={d} />)
          )}
        </>
      ) : searching ? (
        <View style={{ gap: t.spacing.sm }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={68} radius={t.radius.lg} />)}</View>
      ) : results.length === 0 ? (
        <EmptyState icon="search-outline" title={`No matches for "${query}"`} subtitle="Try a simpler term like milk or eggs." />
      ) : (
        results.map((p) => (
          <ProductRow key={p.id} product={p} onPress={() => router.push({ pathname: "/product/[id]", params: { id: p.id, name: p.name, brand: p.brand ?? "" } })} />
        ))
      )}
    </Screen>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  const t = useTheme();
  return (
    <Card elevation="sm" style={{ marginBottom: t.spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
        <View style={{ width: 44, height: 44, borderRadius: t.radius.md, backgroundColor: t.colors.primaryTint, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="flash" size={20} color={t.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="headline">{prettyStore(deal.storeId)}</Text>
          <Text variant="footnote" tone="secondary">Reported nearby</Text>
        </View>
        <Badge label={dealLabel(deal.kind)} tone="brand" />
      </View>
    </Card>
  );
}
