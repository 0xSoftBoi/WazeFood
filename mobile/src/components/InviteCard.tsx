// The referral growth loop (the near-zero-CAC engine the unit economics depend on). Shows the
// user's stable invite link + progress toward the reward (3 friends activated → 30 days Premium),
// with a native Share sheet.

import { useCallback, useEffect, useState } from "react";
import { Share, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Text, useTheme } from "../ui";
import { useSession } from "../session";

// Universal-link base. Configure associated domains for production; the in-app deep-link route
// (app/r/[token].tsx) handles the `smartcart://r/<token>` scheme for installed users + testing.
const LINK_BASE = "https://wazefood.app/r/";

export function InviteCard() {
  const t = useTheme();
  const { api, userId, ensureInvite } = useSession();
  const [token, setToken] = useState<string | null>(null);
  const [activated, setActivated] = useState(0);
  const [required, setRequired] = useState(3);

  const refresh = useCallback(async () => {
    if (userId == null) return;
    try { setToken(await ensureInvite()); } catch { /* offline */ }
    try {
      const p = await api.referralProgress(userId);
      setActivated(p.activated);
      setRequired(p.required);
    } catch { /* offline */ }
  }, [api, userId, ensureInvite]);

  useEffect(() => { void refresh(); }, [refresh]);

  const link = token != null ? `${LINK_BASE}${token}` : "";
  const unlocked = activated >= required;

  const onShare = useCallback(async () => {
    if (token == null) return;
    await Share.share({
      message: `I'm cutting my grocery bill with WazeFood — it finds the cheapest nearby price for everything on my list. Join with my link: ${link}`,
    });
  }, [token, link]);

  return (
    <Card elevation="md" style={{ marginBottom: t.spacing.base }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm, marginBottom: 6 }}>
        <Ionicons name="gift" size={20} color={t.colors.primary} />
        <Text variant="headline">{unlocked ? "Premium unlocked 🎉" : "Invite friends, get Premium"}</Text>
      </View>
      <Text variant="subhead" tone="secondary">
        {unlocked ? "Thanks for spreading the word — enjoy 30 days of Premium." : "Get 30 days of Premium when 3 friends join and start saving."}
      </Text>

      {/* Progress pills */}
      <View style={{ flexDirection: "row", gap: 6, marginTop: t.spacing.base }}>
        {Array.from({ length: required }).map((_, i) => (
          <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: i < activated ? t.colors.primary : t.colors.surfaceSunken }} />
        ))}
      </View>
      <Text variant="caption" tone="secondary" style={{ marginTop: 6 }}>{activated} of {required} friends joined</Text>

      <Button
        title="Share my invite"
        onPress={onShare}
        disabled={token == null}
        left={<Ionicons name="share-outline" size={18} color={t.colors.onPrimary} />}
        fullWidth
        style={{ marginTop: t.spacing.base }}
      />
    </Card>
  );
}
