# RevenueCat Setup — PDFScan Pro

Two ways to buy the same thing:

| Product | Type | Price | Product ID |
|---|---|---|---|
| PDFScan Pro Monthly | **Auto-renewable subscription** | $0.49 / month | `com.sabu.scanner.pro.monthly` |
| PDFScan Pro Lifetime | **Non-consumable** | $4.99 once | `com.sabu.scanner.pro` |

Both unlock the same `pro` entitlement, so nothing in the app cares which was bought. Both remove ads and the PDF footer mark.

> **The monthly subscription brings Guideline 3.1.2 into scope**, which the non-consumable alone avoided. The app side is already handled — the paywall shows the price, the period, the renewal terms, and links to Terms of Use and Privacy Policy. The App Store Connect side is section 1.5 below, and it is the part Apple rejects people for.

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

### 1.3 Create the lifetime product

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

### 1.4 Create the monthly subscription

**Your app → Monetization → Subscriptions → Create** a Subscription Group first (name it `PDFScan Pro` — the group name is user-visible), then add a subscription inside it:

| Field | Value |
|---|---|
| Reference Name | `PDFScan Pro Monthly` |
| Product ID | `com.sabu.scanner.pro.monthly` |
| Duration | **1 month** |
| Price | $0.49 |

Then, on the same page: **Localization** → Display Name `PDFScan Pro Monthly`, Description `Removes ads and the PDF footer mark.` And a **Review screenshot** of the paywall, same as the lifetime product.

Product IDs are permanent — they cannot be renamed or reused after creation.

### 1.5 Guideline 3.1.2 metadata — this is the part that gets rejected

In **App Information**, both of these must be filled in:

- **Privacy Policy URL** — you have the Notion one.
- **Terms of Use (EULA)** — leave blank to use Apple's standard EULA, which is what the app links to. If you paste a custom one, change `TERMS_OF_USE_URL` in `App.js` to match, or the app and the listing will disagree.

Apple checks that the binary shows, on the purchase screen itself: subscription title, length, price per period, and that it auto-renews. The paywall already does this. Do not remove that small-print block.

### 1.6 App-Specific Shared Secret

**Your app → App Information → App-Specific Shared Secret** → generate and copy it. RevenueCat needs this to validate receipts.

---

## Phase 2 — RevenueCat dashboard

### 2.1 App connection

Your project already detected the App Store app. Open **Project Settings → Apps → your iOS app** and confirm:

- **Bundle ID**: `com.sabu.scanner`
- **App-Specific Shared Secret**: paste from step 1.6
- **In-App Purchase Key** / App Store Connect API key: connected

### 2.2 Products

**Product catalog → Products → + New**, twice:

| Product ID | RevenueCat type |
|---|---|
| `com.sabu.scanner.pro` | **Lifetime** (its label for a non-consumable) |
| `com.sabu.scanner.pro.monthly` | **Monthly** |

Both must match App Store Connect exactly.

If ASC hasn't finished processing the product it won't import yet. Wait and retry rather than typing it manually.

### 2.3 Entitlement

**Product catalog → Entitlements → + New**

- Identifier: **`pro`** ← the code checks this exact string
- Attach **both** products to it: `com.sabu.scanner.pro` and
  `com.sabu.scanner.pro.monthly`

Attaching both is what makes the rest of the app indifferent to which one was
bought — `isPro` is a single entitlement check either way.

### 2.4 Offering

**Product catalog → Offerings → + New**

- Identifier: `default`
- Add a **Package** → type **Monthly** → attach `com.sabu.scanner.pro.monthly`
- Add a **Package** → type **Lifetime** → attach `com.sabu.scanner.pro`

The app reads `offering.monthly` and `offering.lifetime` by name. It deliberately does **not** fall back to `availablePackages[0]`: that would let a dashboard edit change which product is charged without going through app review, and with a subscription in the mix that could mean charging a recurring price where a one-time one was shown.

### 2.5 API key

**Project Settings → API Keys** → copy the **Apple** public SDK key. It starts with `appl_`.

That key is safe to ship in the app binary — it's a public key, not a secret. Send it to me and I'll wire it in.

---

## Phase 3 — Code — ✅ DONE

Already in `App.js`:

- `react-native-purchases` configured on launch; every failure is non-fatal, so
  a RevenueCat outage leaves the user on the free tier rather than breaking the app
- `isPro` driven by the real `pro` entitlement, with a customer-info listener
- Paywall offering **both** plans, with the plan picker defaulting to whichever
  package actually exists
- Guideline 3.1.2 small print, Terms of Use and Privacy Policy links
- **Restore Purchases** in both the paywall and Settings
- Ads and the footer mark gated on `isPro`

Core `react-native-purchases` only, not `react-native-purchases-ui`: the hosted
paywalls are nice but add another native module, and the last four build
failures were all native dependency problems.

---

## Phase 4 — Testing

You cannot test IAP in Expo Go or on a normal release build.

1. **Create a sandbox tester**: ASC → **Users and Access → Sandbox → Testers → +**. Use an email you control that is **not** an existing Apple ID.
2. Build a dev client: `eas build -p ios --profile development`
3. On the device: **Settings → Developer → Sandbox Apple Account** → sign in as the tester
4. Purchases will show `[Environment: Sandbox]` in the confirmation dialog and cost nothing

Test all three: a fresh **monthly** purchase, a fresh **lifetime** purchase, and
Restore Purchases after deleting and reinstalling. Restore is what App Review
checks hardest on non-consumables.

Sandbox subscriptions renew on an accelerated clock — a 1-month subscription
renews every 5 minutes and auto-cancels after 6 renewals — so you can watch a
renewal happen rather than assuming it will.

---

## Submission notes for 1.1

**Guideline 3.1.2 now applies.** Offering the monthly subscription brings back
everything the non-consumable alone avoided. The app side is done — the paywall
shows the subscription title, the period, the price per period, the
auto-renewal sentence, and links to Terms of Use and Privacy Policy. What Apple
additionally checks is the listing metadata in step 1.5.

If you ever drop the monthly product, you can drop that small print with it.
While it ships, leave it alone — removing it is a rejection.

Still required:

- [ ] **Restore Purchases** button, easy to find — in the paywall and in Settings
- [ ] Price shown clearly before purchase
- [ ] Privacy Policy link (you already have the Notion one)
- [ ] Terms of Use (EULA) link — Apple's standard one unless you host your own
- [ ] Renewal terms on the purchase screen — already in the paywall
- [ ] **Both products** submitted for review alongside the build — select them in the version's In-App Purchases and Subscriptions sections, or Apple reviews the app without them and purchases fail in production

### What "Pro" gets, exactly

Keep this honest and consistent with the paywall copy:

| | Free | Pro |
|---|---|---|
| Scan, OCR, export, page editor, PDF reader | Yes | Yes |
| Banner + interstitial ads | Yes | None |
| PDF footer mark | Yes | None |
| Price | Free | $0.49/month or $4.99 once |

Nothing that works today is taken away. The only differences are the ads and
the small logo in the bottom margin — which matters, because removing existing
free functionality to sell it back is a Guideline 3.1.1 problem and generates
1-star reviews besides.

One consequence worth planning for: the footer mark is now a small logo rather
than a wordmark, so it is much less of a reason to pay. The ads carry the Pro
pitch. If you want more Pro value later, add genuinely new capability rather
than taking anything out of the free tier.

Nothing that works today gets taken away except the watermark. That matters — removing existing free functionality to sell it back is a Guideline 3.1.1 problem, and it generates 1-star reviews besides.
