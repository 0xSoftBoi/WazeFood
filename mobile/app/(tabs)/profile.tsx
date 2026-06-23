import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Badge, Card, Screen, Skeleton, Text, useTheme } from "../../src/ui";
import { SocialSignIn } from "../../src/components/SocialSignIn";
import { socialEnabled } from "../../src/config";
import { useSession } from "../../src/session";
import type { Gamification, Leaderboard } from "../../src/api/client";

export default function ProfileScreen() {
  const t = useTheme();
  const { api, userId, location, auth, linkWith } = useSession();
  const [game, setGame] = useState<Gamification | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const onToken = useCallback(async (provider: string, token: string) => {
    setLinking(provider);
    setLinkError(null);
    try {
      await linkWith(provider, token);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setLinking(null);
    }
  }, [linkWith]);

  const load = useCallback(async () => {
    if (userId == null) return;
    const [g, b] = await Promise.allSettled([api.gamification(userId), api.leaderboard("weekly", location.metro)]);
    if (g.status === "fulfilled") setGame(g.value);
    if (b.status === "fulfilled") setBoard(b.value);
  }, [api, userId, location.metro]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const myRank = board?.entries.findIndex((e) => e.userId === userId) ?? -1;

  return (
    <Screen grouped refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <Text variant="largeTitle" style={{ paddingVertical: t.spacing.base }}>You</Text>

      <Card elevation="md" style={{ marginBottom: t.spacing.base }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.base }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.primary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={auth.signedIn ? "checkmark" : "person"} size={26} color={t.colors.onPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="title3">{auth.signedIn ? "Signed in" : "Guest shopper"}</Text>
            <Text variant="footnote" tone="secondary">
              {auth.signedIn ? `Saved across your devices${auth.provider != null ? ` · ${auth.provider}` : ""}` : "Sign in to save your list across devices"}
            </Text>
          </View>
        </View>

        {!auth.signedIn && socialEnabled && (
          <View style={{ marginTop: t.spacing.base, gap: t.spacing.sm }}>
            <SocialSignIn onToken={onToken} busy={linking} />
            {linkError != null && <Text variant="footnote" tone="danger">{linkError}</Text>}
          </View>
        )}
      </Card>

      <View style={{ flexDirection: "row", gap: t.spacing.sm, marginBottom: t.spacing.base }}>
        <StatCard label="Karma" value={game?.karma} loading={game == null} icon="flame" />
        <StatCard label="Rank" value={myRank >= 0 ? myRank + 1 : undefined} prefix="#" loading={board == null} icon="trophy" />
        <StatCard label="Badges" value={game?.badges.length} loading={game == null} icon="ribbon" />
      </View>

      {game != null && game.badges.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm, marginBottom: t.spacing.lg }}>
          {game.badges.map((b) => <Badge key={b} label={b} tone="brand" />)}
        </View>
      )}

      <Text variant="title3" style={{ marginBottom: t.spacing.md }}>This week's leaders</Text>
      {board == null ? (
        <View style={{ gap: t.spacing.sm }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={56} radius={t.radius.lg} />)}</View>
      ) : board.entries.length === 0 ? (
        <Text variant="subhead" tone="secondary">No contributors yet — report a price to get on the board.</Text>
      ) : (
        board.entries.slice(0, 10).map((e, i) => {
          const me = e.userId === userId;
          return (
            <Card key={e.userId} elevation="sm" style={[{ marginBottom: t.spacing.sm }, me && { borderColor: t.colors.primary, borderWidth: 1.5 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
                <Text variant="headline" tone={i < 3 ? "brand" : "secondary"} style={{ width: 28 }}>{i + 1}</Text>
                <Text variant="body" weight={me ? "700" : "400"} style={{ flex: 1 }}>{me ? "You" : `Shopper ${e.userId.slice(-4)}`}</Text>
                <Text variant="headline" tone="brand">{Math.round(e.score)}</Text>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

function StatCard({ label, value, prefix, loading, icon }: { label: string; value?: number; prefix?: string; loading: boolean; icon: keyof typeof Ionicons.glyphMap }) {
  const t = useTheme();
  return (
    <Card elevation="sm" style={{ flex: 1, alignItems: "center", paddingVertical: t.spacing.base }}>
      <Ionicons name={icon} size={20} color={t.colors.primary} />
      {loading ? (
        <Skeleton width={36} height={26} style={{ marginVertical: 4 }} />
      ) : (
        <Text variant="title2" style={{ marginVertical: 2 }}>{value == null ? "—" : `${prefix ?? ""}${value}`}</Text>
      )}
      <Text variant="caption" tone="secondary">{label}</Text>
    </Card>
  );
}
