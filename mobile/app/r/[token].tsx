// Referral attribution. Opening `smartcart://r/<token>` (or the universal link) lands here: once the
// anonymous session is ready we record the open (POST /referrals/open), tying this new guest to the
// inviter, then drop them into the app. Idempotent per token so a re-open doesn't double-count.

import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { Button, Screen, Text, useTheme } from "../../src/ui";
import { useSession } from "../../src/session";

export default function ReferralOpenScreen() {
  const t = useTheme();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { api, userId, ready } = useSession();
  const [status, setStatus] = useState<"working" | "done" | "error">("working");

  useEffect(() => {
    if (!ready || userId == null || token == null) return;
    (async () => {
      try {
        const flag = `sc.referredBy.${token}`;
        if ((await AsyncStorage.getItem(flag)) == null) {
          await api.openReferral(token, userId);
          await AsyncStorage.setItem(flag, "1");
        }
        setStatus("done");
      } catch {
        setStatus("error");
      }
    })();
  }, [ready, userId, token, api]);

  return (
    <Screen grouped>
      <Stack.Screen options={{ title: "" }} />
      <View style={{ alignItems: "center", paddingVertical: t.spacing.xxxl, gap: t.spacing.base }}>
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: t.colors.primaryTint, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={status === "error" ? "alert" : "gift"} size={42} color={t.colors.primary} />
        </View>
        <Text variant="title2" center>{status === "error" ? "Couldn't open that link" : "You're in 🎉"}</Text>
        <Text variant="subhead" tone="secondary" center>
          {status === "error"
            ? "The invite link looks invalid — you can still start saving."
            : "A friend invited you to WazeFood. Search any product to see the cheapest price near you."}
        </Text>
        <Button title="Start saving" onPress={() => router.replace("/")} style={{ marginTop: t.spacing.sm }} />
      </View>
    </Screen>
  );
}
