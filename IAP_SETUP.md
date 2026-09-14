# RevenueCat Setup — PDFScan Pro (one-time unlock)

Target: a **non-consumable** $4.99 purchase that removes ads and the PDF watermark, forever.

Do these phases **in order**. RevenueCat imports products from App Store Connect, so ASC has to be right first.

---

## Phase 1 — App Store Connect

### 1.1 Paid Applications Agreement — ✅ ALREADY DONE

Verified on the Business page:

| Item | Status |
|---|---|
| Paid Apps Agreement | **Active** (Jun 24, 2026 – Apr 20, 2027) |
| Bank Account (Kenya, KES / USD royalties) | **Active** |
| U.S. Form W-8BEN | **Active** |
| U.S. Certificate of Foreign Status | **Active** |

Nothing further to sign. This is the prerequisite that silently breaks IAP — without it products return an empty list with no error — and it's clear.

### 1.2 Small Business Program

Enrollment is **not** on the Business page. Two ways in:

- https://developer.apple.com/app-store/small-business-program/ → **Enroll**, or
- App Store Connect → **Business** → scroll to **App Store Small Business Program**

Requirements you already meet: you're the Account Holder, and the latest Paid Apps agreement is accepted.

The form takes about a minute — confirm proceeds were under $1M last calendar year, declare any Associated Developer Accounts (likely "none"), submit.

**Timing matters.** Enrollment takes effect from the **start of the following month**, so enrolling now covers you before any real sales land. On a $4.99 unlock: **$4.24** to you at 15% versus **$3.49** at 30%.

### 1.3 Create the product

**Your app → Monetization → In-App Purchases → +**

| Field | Value |
|---|---|
| Type | **Non-Consumable** ← not a subscription |
| Reference Name | `PDFScan Pro` |
| Product ID | `com.sabu.scanner.pro` |
| Price | Tier for **$4.99** |

Then fill in, on the same page:

- **App Store Localization** → Display Name: `PDFScan Pro`, Description: `Remove ads and the PDF watermark forever.`
- **Review Information → Screenshot** — required before Apple will review it. A screenshot of your paywall screen. You can't take this until the app builds with the paywall, so come back to it.

Product ID is permanent — it cannot be renamed or reused after creation. Get it right.

### 1.4 App-Specific Shared Secret

**Your app → App Information → App-Specific Shared Secret** → generate and copy it. RevenueCat needs this to validate receipts.

---

## Phase 2 — RevenueCat dashboard

### 2.1 App connection

Your project already detected the App Store app. Open **Project Settings → Apps → your iOS app** and confirm:

- **Bundle ID**: `com.sabu.scanner`
- **App-Specific Shared Secret**: paste from step 1.4
- **In-App Purchase Key** / App Store Connect API key: connected

### 2.2 Product

**Product catalog → Products → + New**

- Store: App Store
- Product ID: `com.sabu.scanner.pro` — must match ASC exactly
- Type: **Lifetime** (RevenueCat's label for a non-consumable)

If ASC hasn't finished processing the product it won't import yet. Wait and retry rather than typing it manually.

### 2.3 Entitlement

**Product catalog → Entitlements → + New**

- Identifier: **`pro`** ← the code checks this exact string
- Attach the `com.sabu.scanner.pro` product to it

### 2.4 Offering

**Product catalog → Offerings → + New**

- Identifier: `default`
- Add a **Package** → type **Lifetime** → attach the product

### 2.5 API key

**Project Settings → API Keys** → copy the **Apple** public SDK key. It starts with `appl_`.

That key is safe to ship in the app binary — it's a public key, not a secret. Send it to me and I'll wire it in.

---

## Phase 3 — Code (I do this)

Once you send me the API key:

- `npx expo install react-native-purchases`
- Configure the SDK on launch
- Replace the `isPro` stub in `App.js` with the real entitlement check
- Build the paywall screen
- Add **Restore Purchases** — Apple requires this for non-consumables and App Review tests it specifically
- Gate the watermark and ads on `isPro`

I'm proposing the core `react-native-purchases` only, not `react-native-purchases-ui`. Their hosted paywalls are nice but add another native module, and your last four build failures were all native dependency problems. A hand-built paywall for one product is maybe 80 lines and has no extra build surface.

---

## Phase 4 — Testing

You cannot test IAP in Expo Go or on a normal release build.

1. **Create a sandbox tester**: ASC → **Users and Access → Sandbox → Testers → +**. Use an email you control that is **not** an existing Apple ID.
2. Build a dev client: `eas build -p ios --profile development`
3. On the device: **Settings → Developer → Sandbox Apple Account** → sign in as the tester
4. Purchases will show `[Environment: Sandbox]` in the confirmation dialog and cost nothing

Test both a fresh purchase **and** Restore Purchases after deleting and reinstalling. Restore is what App Review checks hardest on non-consumables.

---

## Submission notes for 1.1

Because this is a **non-consumable**, you skip almost all of Guideline 3.1.2 — no Terms of Use (EULA) URL, no renewal disclosure, no subscription-length text. That's precisely why it was chosen over the $1/month subscription.

Still required:

- [ ] **Restore Purchases** button, easy to find
- [ ] Price shown clearly before purchase
- [ ] Privacy Policy link (you already have the Notion one)
- [ ] The IAP product submitted **for review alongside the build** — select it in the version's In-App Purchases section, or Apple reviews the app without it and the purchase fails in production

### What "Pro" gets, exactly

Keep this honest and consistent with the paywall copy:

| | Free | Pro |
|---|---|---|
| Scan, OCR, export | Yes | Yes |
| Banner + interstitial ads | Yes | None |
| PDF watermark | Yes | None |
| Price | Free | $4.99 once |

Nothing that works today gets taken away except the watermark. That matters — removing existing free functionality to sell it back is a Guideline 3.1.1 problem, and it generates 1-star reviews besides.
