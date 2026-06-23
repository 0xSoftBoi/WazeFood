// Default (web / Android): Apple sign-in is iOS-only, so render nothing. Metro picks AppleButton.ios.tsx
// on iOS; this base file keeps the web/Android bundles from importing expo-apple-authentication.

export type AppleButtonProps = { onToken: (provider: string, token: string) => void; busy?: boolean };

export function AppleButton(_props: AppleButtonProps) {
  return null;
}
