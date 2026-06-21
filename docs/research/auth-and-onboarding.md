# Auth — The Proper Implementation & The Smoothest Onboarding

Two goals that look opposed — *proper, secure auth* and *frictionless onboarding* — but for
SmartCart they aren't, because the product spec already chose the resolution: **anonymous-first**.
Let users build a list and see savings with **zero signup**, then ask them to "save your list"
only after they've felt the value. This memo researches the proper way to do both.

## 1. The smoothest onboarding (the product priority)

The brain dump is explicit: *"Do not block first-time list creation with account creation… ask to
create account only after save."* The research backs this hard:

- **Anonymous / guest first.** Forcing account creation before value is *one of the most studied
  conversion killers*; Duolingo and TikTok let users use the app before signup, postponing the
  account barrier until after the value hooks them ([CleverTap onboarding](https://clevertap.com/blog/user-onboarding-best-practices/), [Userpilot progressive onboarding](https://userpilot.com/blog/progressive-onboarding/)).
- **Defer the ask to the "save your list" moment** (and "tell me when eggs drop" for push), exactly
  the PDF flow. Progressive onboarding reveals asks contextually, at the moment they're needed.
- **Social one-tap as the primary path.** Social login can lift conversion **~20%**, and **Google
  One Tap** measurably improves signups; **Sign in with Apple** is privacy-preserving and is
  *required* on iOS if you offer other social logins ([Auth0 social login](https://auth0.com/learn/social-login), [Apple](https://support.apple.com/en-us/102609)).
- **Passwordless for email.** **Passkeys** (WebAuthn/FIDO2) are the 2026 mainstream — cryptographic,
  phishing-resistant; **magic links** are a fine simpler fallback. **SMS OTP is NIST-deprecated**
  (SIM-swap) and *should not be a primary auth method* — so SmartCart's SMS stays where the PDF put
  it: **referral anti-fraud only**, never login ([Authgear passwordless](https://www.authgear.com/post/passwordless-authentication-magic-links-passkeys-otp/), [MojoAuth comparison](https://mojoauth.com/blog/magic-links-passkeys-otp-and-social-login-which-passwordless-method-fits-your-application)).
- **Just-in-time permissions** (push at alert intent, camera at scan) — already specced; raises grant rates.
- **Deferred deep linking** preserves referral context *through* an app install, protecting the
  referral funnel's activation ([AppTweak](https://www.apptweak.com/en/aso-blog/mobile-app-onboarding-mastering-deep-linking-smart-banners)).

**The one technical pattern that makes this work:** an **anonymous account that upgrades in place** —
when the guest signs in with Apple/Google/email, the *same user id* is kept and all their lists,
contributions, karma, and referral progress carry over. (Firebase calls this `linkWithCredential`;
it's the make-or-break detail of anonymous-first.)

## 2. The proper auth implementation

Once a session exists, secure it the standard way ([Duende JWT best practices](https://duendesoftware.com/learn/best-practices-using-jwts-with-web-and-mobile-apps), [Okta refresh rotation](https://developer.okta.com/docs/guides/refresh-tokens/main/), [OWASP Auth cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)):

- **Short-lived access JWT (15–30 min)** + **rotating refresh token (single-use, 7–14 days)**.
  Every refresh issues a new one and invalidates the old.
- **Refresh-reuse detection.** If an already-rotated refresh token is presented again, treat it as
  theft and **revoke the whole token family** — converts catastrophic theft into a one-use window.
- **Different secrets** for access vs refresh; **access token in memory** (never localStorage);
  **refresh in iOS Keychain / Android Keystore** (hardware-backed); web uses the **BFF** pattern
  (refresh stays server-side) ([OWASP MASTG](https://mas.owasp.org/MASTG/0x04e-Testing-Authentication-and-Session-Management/), [secure mobile storage](https://capgo.app/blog/secure-token-storage-best-practices-for-mobile-developers/)).
- **Per-device, revocable sessions** (OWASP Mobile M3/M4) — the user can sign out a lost device.
- **Social/OIDC**: the provider (Apple/Google) returns an `id_token`; the backend **verifies it
  against the provider's JWKS** (issuer, audience, signature, nonce), then **mints its own session**
  bound to the SmartCart user. Never trust a client-asserted identity (today's demo `Bearer user:<id>`
  is exactly what we're replacing).

## 3. Buy vs build

The consensus is blunt: **fewer than 5% of teams should build auth from scratch** — it's 200+ days
for full coverage, ~12–15 integration bugs per implementation, and a permanent security liability;
**buy unless auth is your core differentiator** ([Stytch build-vs-buy](https://stytch.com/blog/build-vs-buy/), [FusionAuth](https://fusionauth.io/buildvsbuy)). It isn't ours — groceries are.

| Provider | Why for SmartCart |
|---|---|
| **Firebase Auth** | **Pragmatic pick.** Free, first-class **Anonymous Auth + `linkWithCredential`** (the exact anonymous-upgrade pattern), great mobile SDKs, Apple/Google built in ([Clerk comparison](https://clerk.com/articles/user-management-platform-comparison-react-clerk-auth0-firebase)) |
| **Stytch / Clerk** | Best DX + passwordless/passkeys + conversion-tuned UIs; generous free tiers ([Stytch passwordless](https://stytch.com/blog/passwordless-authentication-solutions/)) |
| **Cognito** | Cheapest at scale if all-in on AWS; dated DX |
| **Auth0** | Powerful but pricier post-Okta |

**The split:** **buy** the IdP (Firebase/Stytch) for social + passkeys + the hosted flows; **build
only the thin part you must own** — verifying the provider token, minting *your* session, and the
**anonymous→identity upgrade** in your `identity` module. That's exactly what's implemented below.

## 4. What SmartCart builds now (grounded, verifiable)

The IdP is a deployment choice; the backend pieces that are ours and testable offline:

1. **Session layer** — short-lived access JWT (HS256 via `node:crypto`, no new dep) + **rotating
   refresh with reuse detection + per-device revocation**.
2. **OIDC-verify seam** — a pluggable `IdentityVerifier` (dev verifier now; Apple/Google JWKS is the
   drop-in). Verify the provider token → resolve/link the user.
3. **Anonymous → upgrade in place** — `link()` keeps the same `userId` (all lists/karma/referrals
   intact) when a guest signs in; if the identity already belongs to someone, it's a sign-in to that
   account. This replaces the demo bearer and makes anonymous-first real.

## 5. What NOT to do
- Don't force signup before value (the conversion killer) — anonymous-first stays.
- Don't use **SMS OTP as primary auth** (NIST-deprecated) — SMS is referral anti-fraud only.
- Don't store tokens in `localStorage`; don't ship long-lived non-rotating refresh tokens.
- Don't build a full IdP — buy it; own only the session + upgrade logic.

---

## Sources
- Onboarding — [CleverTap](https://clevertap.com/blog/user-onboarding-best-practices/) · [Userpilot progressive onboarding](https://userpilot.com/blog/progressive-onboarding/) · [Auth0 social login](https://auth0.com/learn/social-login) · [AppTweak deep linking](https://www.apptweak.com/en/aso-blog/mobile-app-onboarding-mastering-deep-linking-smart-banners) · [Apple Sign in](https://support.apple.com/en-us/102609)
- Tokens & storage — [Duende JWT best practices](https://duendesoftware.com/learn/best-practices-using-jwts-with-web-and-mobile-apps) · [Okta refresh rotation](https://developer.okta.com/docs/guides/refresh-tokens/main/) · [OWASP Authentication cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) · [OWASP MASTG auth](https://mas.owasp.org/MASTG/0x04e-Testing-Authentication-and-Session-Management/) · [secure mobile token storage](https://capgo.app/blog/secure-token-storage-best-practices-for-mobile-developers/)
- Passwordless — [Authgear](https://www.authgear.com/post/passwordless-authentication-magic-links-passkeys-otp/) · [MojoAuth](https://mojoauth.com/blog/magic-links-passkeys-otp-and-social-login-which-passwordless-method-fits-your-application)
- Buy vs build & providers — [Stytch build-vs-buy](https://stytch.com/blog/build-vs-buy/) · [FusionAuth](https://fusionauth.io/buildvsbuy) · [Clerk vs Auth0 vs Firebase](https://clerk.com/articles/user-management-platform-comparison-react-clerk-auth0-firebase) · [Zuplo auth pricing](https://zuplo.com/blog/2024/11/27/api-authentication-pricing)
