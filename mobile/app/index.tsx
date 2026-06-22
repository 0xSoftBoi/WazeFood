// The vertical slice: an anonymous session is started on launch; type a query → search products →
// tap a product → see the best nearby price. Same code runs on web, iOS, and Android.

import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useApi } from "../src/session";
import { DEMO_LOCATION } from "../src/config";
import type { BestPrice, Product } from "../src/api/client";

export default function SearchScreen() {
  const { api, session } = useApi();
  const [query, setQuery] = useState("milk");
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<{ product: Product; price: BestPrice } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    setSearching(true);
    setError(null);
    setSelected(null);
    try {
      const res = await api.search(query);
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [api, query]);

  const pickProduct = useCallback(
    async (product: Product) => {
      setError(null);
      try {
        const price = await api.bestPrice(product.id, DEMO_LOCATION.lat, DEMO_LOCATION.lng);
        setSelected({ product, price });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [api],
  );

  if (!session.ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0f766e" />
        <Text style={styles.muted}>Starting your session…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {session.error != null && <Text style={styles.error}>Session error: {session.error}</Text>}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search groceries (e.g. milk, eggs)"
          autoCapitalize="none"
          onSubmitEditing={runSearch}
          returnKeyType="search"
        />
        <Pressable style={styles.button} onPress={runSearch} disabled={searching}>
          <Text style={styles.buttonText}>{searching ? "…" : "Search"}</Text>
        </Pressable>
      </View>

      {error != null && <Text style={styles.error}>{error}</Text>}

      {selected != null && (
        <View style={styles.priceCard}>
          <Text style={styles.priceTitle}>{selected.product.name}</Text>
          {selected.price.found ? (
            <>
              <Text style={styles.price}>${selected.price.price?.toFixed(2)}</Text>
              <Text style={styles.muted}>
                {(selected.price.distanceMeters! / 1000).toFixed(1)} km away · confidence{" "}
                {Math.round((selected.price.confidence ?? 0) * 100)}%
              </Text>
            </>
          ) : (
            <Text style={styles.muted}>No nearby price yet — be the first to contribute one.</Text>
          )}
        </View>
      )}

      <FlatList
        data={results}
        keyExtractor={(p) => p.id}
        style={styles.list}
        ListEmptyComponent={!searching ? <Text style={styles.muted}>Search to see products.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => pickProduct(item)}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.muted}>
              {item.brand ?? "—"}
              {item.isStoreBrand ? " · store brand" : ""}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff", gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#fff" },
  searchRow: { flexDirection: "row", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  button: { backgroundColor: "#0f766e", borderRadius: 8, paddingHorizontal: 16, justifyContent: "center" },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  list: { flex: 1 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  rowTitle: { fontSize: 16, fontWeight: "500", color: "#111827" },
  muted: { color: "#6b7280", fontSize: 13 },
  error: { color: "#b91c1c", fontSize: 13 },
  priceCard: { backgroundColor: "#f0fdfa", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#99f6e4" },
  priceTitle: { fontSize: 16, fontWeight: "600", color: "#134e4a" },
  price: { fontSize: 32, fontWeight: "800", color: "#0f766e", marginTop: 4 },
});
