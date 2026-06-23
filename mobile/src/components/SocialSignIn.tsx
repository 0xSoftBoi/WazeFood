// Feature-flagged social sign-in. Only the providers whose OAuth client IDs are configured (see
// src/config.ts `social`) render a button. Google uses expo-auth-session to obtain an id_token in
// the browser/native; Apple uses the native button (iOS only). Either way we hand (provider, token)
// up to the caller, which links it via /auth/link (the backend verifies the token against JWKS).

import { useEffect } from "react";
import { View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { Ionicons } from "@expo/vector-icons";
import { Button, useTheme } from "../ui";
import { social } from "../config";
import { AppleButton } from "./AppleButton";

WebBrowser.maybeCompleteAuthSession();

export function SocialSignIn({ onToken, busy }: { onToken: (provider: string, token: string) => void; busy?: string | null }) {
  const t = useTheme();
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: social.google.web,
    iosClientId: social.google.ios,
    androidClientId: social.google.android,
  });

  useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.params?.id_token;
      if (typeof idToken === "string" && idToken.length > 0) onToken("google", idToken);
    }
  }, [response, onToken]);

  return (
    <View style={{ gap: t.spacing.sm }}>
      {social.google.enabled && (
        <Button
          title="Continue with Google"
          variant="secondary"
          loading={busy === "google"}
          disabled={request == null}
          onPress={() => { void promptAsync(); }}
          left={<Ionicons name="logo-google" size={18} color={t.colors.textPrimary} />}
          fullWidth
        />
      )}
      {social.apple.enabled && <AppleButton onToken={onToken} busy={busy === "apple"} />}
    </View>
  );
}
