// iOS Apple "Sign in with Apple" — the official button (required by App Store review when offering
// Apple sign-in). Hands the identityToken (an OIDC id_token) up; the backend verifies it via JWKS.

import { useEffect, useState } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import type { AppleButtonProps } from "./AppleButton";

export function AppleButton({ onToken }: AppleButtonProps) {
  const [available, setAvailable] = useState(false);
  useEffect(() => { void AppleAuthentication.isAvailableAsync().then(setAvailable); }, []);
  if (!available) return null;
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={12}
      style={{ height: 48 }}
      onPress={async () => {
        try {
          const cred = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL] });
          if (cred.identityToken != null) onToken("apple", cred.identityToken);
        } catch {
          /* user canceled */
        }
      }}
    />
  );
}
