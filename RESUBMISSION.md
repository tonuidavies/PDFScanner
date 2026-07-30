# Resubmission Checklist — FreeAIDocumentScanner PRO

App Store Connect app: `com.sabu.scanner` · Next build: 1.0 (12)

---

## How the four rejections chained together

Each fix caused the next rejection. Understanding the chain matters, because it explains why the same guideline kept reappearing.

| Date | Build | Device / OS | Guideline | What Apple said |
|---|---|---|---|---|
| **May 19, 2026** | 1.0 (3) | iPad Air 11″ (M3), iPadOS 26.4.2 | **2.3.8** | Listing name "FreeAIDocumentScanner PRO" ≠ device name "PDFScan" |
| | | | **2.1** | ATT framework linked, but the permission prompt never appeared |
| **May 20, 2026** | 1.0 (1) | iPad Air + iPhone 17 Pro Max, 26.5 | **2.1** | ATT prompt *still* not appearing |
| **May 24, 2026** | 1.0 (4) | iPad Air 11″ (M3) | **5.1.2(i)** | Privacy labels declare tracking (Advertising Data) with no ATT prompt |
| **Jun 7, 2026** | 1.0 (11) | iPhone 17 Pro Max, iOS 26.5 | **2.1(a)** | Crashed on launch |

### Why the ATT prompt never appeared (May 19 / 20 / 24)

`NSUserTrackingUsageDescription` *was* present back then, so the plist wasn't the problem. The bug was **timing**: `requestTrackingPermissionsAsync()` was called inside the very first `useEffect`, which fires while the splash screen is still up and the app is not yet `UIApplicationStateActive`. iOS silently refuses to present the ATT dialog in that state — it returns immediately with no prompt. The call was wrapped in `try/catch` and its return value discarded, so the failure was invisible in testing.

Apple then escalated to **5.1.2(i)** on May 24 because the App Store Connect privacy labels claimed tracking that the app was never actually able to request permission for.

### Why build 11 crashed (Jun 7)

The attempted fix (commits `6bd9cf9 "Remove tracking"` and `df26383 "disable tracking"`) removed `NSUserTrackingUsageDescription` from `app.json` **but left the `requestTrackingPermissionsAsync()` call in `App.js`**. Requesting ATT without that Info.plist key is an instant `NSInvalidArgumentException` → SIGABRT. Because it's a native ObjC exception, the surrounding JavaScript `try/catch` could not intercept it. The app died before the first frame — exactly the launch crash Apple reported.

---

## Code changes (done)

| Rejection | Fix |
|---|---|
| 2.1(a) crash | Removed the ATT call, its import, and the `expo-tracking-transparency` dependency entirely |
| 2.1 / 5.1.2(i) | App no longer tracks. Ads request non-personalized only (`requestNonPersonalizedAdsOnly: true`), AD_ID moved to `blockedPermissions` |
| 2.3.8 name | `app.json` name → `FreeAIDocumentScanner PRO`, so `CFBundleDisplayName` now matches the listing |
| 2.3.1 risk | **OCR is now real** — was a `setTimeout` stub that faked success |
| 5.1.1 | Dropped the unused `NSMicrophoneUsageDescription`; photo permission now prompts at point of use, not on launch |
| Stability | Added the required `mobileAds().initialize()`; `BannerAd` gated behind an `adsReady` flag |

### OCR, specifically

The old `extractOCR()` waited 2.5 seconds, then displayed *"Text extracted from N page(s) — Connect ML Kit / Cloud Vision for live extraction."* with a **`Copy Text` button wired to `onPress: () => {}`**. No text was ever read. Shipping that under a name containing "AI" was a Guideline 2.3.1 rejection waiting to happen.

It now uses `expo-text-extractor` — **Apple Vision on iOS, Google ML Kit on Android**, fully on-device:

- Real per-page extraction with live `2/5` progress on the button
- A results modal showing the actual recognized text, selectable, page by page
- A **working** Copy Text button (`expo-clipboard`) with a "Copied" confirmation
- Share as `.txt`
- Honest empty state when no text is detected, instead of a fake success message
- No network calls — so this adds **nothing** to your privacy labels

---

## Before you build

**Do a clean install — not an incremental one.** Your `node_modules` currently has a broken `expo-font`; see the box below.

```bash
cd ~/apps/PDFScanner
rm -rf node_modules package-lock.json
rm -rf ios android          # stale prebuild from Jun 4; EAS regenerates it
npm install
npx expo-doctor             # must report no version mismatches
```

Then:

```bash
eas build -p ios --profile production
```

Sanity-check the install before building:

```bash
npm ls expo-font            # must show 14.0.11 ONLY — no second version
```

### The `FontDisplay` bundling error

If you hit this:

```
> 166 | export { FontDisplay, } from './Font.types';
```

…you have two copies of `expo-font` and Metro is resolving the wrong one:

| Path | Version | |
|---|---|---|
| `node_modules/expo-font` | **57.0.1** | ✗ wrong — from a much later SDK |
| `node_modules/expo/node_modules/expo-font` | **14.0.11** | ✓ what SDK 54 requires |

**Cause.** `@expo/vector-icons@15.1.1` declares `peerDependencies: { "expo-font": ">=14.0.4" }` — an open-ended range with no upper bound. Once `@expo/vector-icons` sits in the root `dependencies`, npm satisfies that peer with the newest *published* `expo-font`, which is 57.0.1. It hoists to the root and shadows the correct copy. That build even ships an `expo.modules.font-57.0.1.aar` native artifact, so Android would break too.

Version 14.0.11 does not contain that `export { FontDisplay, }` line at all — its presence is proof you're on 57.0.1.

**Fix, already applied to `package.json`:**

```jsonc
"dependencies": {
  "expo-font": "~14.0.11",   // explicit root pin
  ...
},
"overrides": {
  "expo-font": "~14.0.11"    // forces every transitive resolution to match
}
```

The `overrides` block is the part that actually holds. Without it, any future `npm install` can re-resolve that open peer range and reintroduce the same break.

### The Kotlin `metadata is 2.3.0, expected version is 2.1.0` error

If the Android build fails with:

```
Execution failed for task ':react-native-google-mobile-ads:compileDebugKotlin'
> Module was compiled with an incompatible version of Kotlin.
  The binary version of its metadata is 2.3.0, expected version is 2.1.0.
```

**Same root cause as the `expo-font` break: an unpinned caret.** `package.json` said `^16.3.2`, so a fresh `npm install` resolved `react-native-google-mobile-ads` up to **16.4.0**. The two versions pin different Google Play Services:

| Library version | `play-services-ads` | Compiled with Kotlin | Works on SDK 54? |
|---|---|---|---|
| **16.3.2** | 25.0.0 | 2.1.x | ✓ — this is what shipped as build 11 |
| 16.4.0 | **25.4.0** | **2.3.0** | ✗ — Expo SDK 54 / RN 0.81 is on Kotlin 2.1.x |

A Kotlin compiler cannot read metadata produced by a *newer* Kotlin. Nothing in your code is wrong; 16.4.0 simply isn't usable on SDK 54 until Expo ships Kotlin 2.3.

**Fix, already applied:** the three third-party native modules are now pinned to exact versions — no carets — plus an override on the ads library:

```jsonc
"react-native-google-mobile-ads": "16.3.2",      // was ^16.3.2
"react-native-document-scanner-plugin": "2.0.4", // was ^2.0.4
"expo-text-extractor": "2.0.0"                   // was ^2.0.0
```

Do **not** restore the carets. On a project this close to shipping, a minor-version bump in a native module means a new transitive Android/iOS SDK, and you find out at compile time — or worse, at launch on a reviewer's device.

> Resist "upgrade to 16.4.0 to fix it." The newer version is the cause, not the cure.

### Benign warning you can ignore

```
WARNING: react-native-google-mobile-ads requires an 'android_app_id' property
         inside a 'react-native-google-mobile-ads' key in your app.json.
```

The warning text itself says to ignore it when using the Expo config plugin, which you are. Verified — the plugin writes the ID into the manifest correctly:

```xml
<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID"
           android:value="ca-app-pub-3940256099942544~3347511713" .../>
```

That value is still Google's **test** app ID, which is the AdMob change flagged above — but the wiring works.

### Deferred to 1.0.1 — AdMob App ID

**Decision: shipping 1.0 with the test App ID.** Apple does not inspect AdMob IDs, so this does not affect review. Approval now is worth more than ad fill.

`app.json` carries Google's **test** app ID:

```
ca-app-pub-3940256099942544~1458002511   ← Google's public test publisher
```

…while your ad units belong to publisher `5117316644857484`. Requests will fail on publisher mismatch, so **you will earn nothing until 1.0.1**. The banner area stays blank; nothing crashes.

**To fix in 1.0.1:** apps.admob.com → **Apps** → your app → **App settings**. The App ID is at the top and begins with `ca-app-pub-5117316644857484~`. Replace both `iosAppId` and `androidAppId` in the `react-native-google-mobile-ads` plugin block.

> Do **not** delete `GADApplicationIdentifier` to "clean up". The Google Mobile Ads SDK aborts at launch if it is missing or blank, and that abort is a native exception no JavaScript `try/catch` can intercept. A wrong-but-well-formed ID is safe; an absent one is a launch crash.

---

## App Store Connect — do these before submitting

### 1. Privacy labels — currently set to "Data Not Collected", which is WRONG

The tracking flag is correctly cleared, so **5.1.2(i) is resolved**. But the label now says *"The developer does not collect any data from this app"* — and that is inaccurate while you ship AdMob. Apple explicitly rejects for this:

> Apps that are found to be engaging in this practice, or that reference SDKs (including but not limited to Ad Networks, Attribution services, and Analytics) that are, may be rejected from the App Store.

Underreported SDK collection is the single most common privacy-label error. You have swapped a 5.1.2(i) rejection for a 5.1.1 one.

**Per [Google's own disclosure guide](https://developers.google.com/admob/ios/privacy/data-disclosure), the Mobile Ads SDK collects:** IP address (used to estimate coarse location), crash logs, user-associated performance data, Device ID, advertising data, and product interactions.

Declare exactly this — App Store Connect → **App Privacy** → **Data Types** → **Edit**:

| Apple category | Data type | Purpose | Linked to user? | Used for tracking? |
|---|---|---|---|---|
| Identifiers | Device ID | Third-Party Advertising | No | **No** |
| Usage Data | Advertising Data | Third-Party Advertising | No | **No** |
| Usage Data | Product Interaction | Analytics | No | **No** |
| Diagnostics | Crash Data | App Functionality | No | **No** |
| Diagnostics | Performance Data | Analytics | No | **No** |
| Location | Coarse Location | Third-Party Advertising | No | **No** |

Every row is **Not Linked to You** and **not used for tracking**. That combination is accurate and consistent: you serve non-personalized ads (`requestNonPersonalizedAdsOnly: true`), you have no user accounts, and you run no ATT prompt. "We collect this, we don't track you with it" is exactly the story your code now tells.

Requires Account Holder or Admin role. **Publish** when done.

> Do **not** leave it as "Data Not Collected" and hope. That claim is checkable — Apple can see the ad SDK in your binary and read the Google privacy manifest bundled inside it.

### 2. App name — already fixed, do not touch it

Your listing is currently **"PDFScan: Doc & File Scanner"**, not the "FreeAIDocumentScanner PRO" cited in the May 19 rejection. You already resolved 2.3.8 by renaming the listing.

`app.json` is set to `"PDFScan"`, which Apple accepts as sufficiently similar. **Leave both as they are.** Renaming either side now would reopen a closed rejection.

### 3. Review notes

Paste into **App Review Information → Notes**:

```
This build removes App Tracking Transparency entirely. The app does
not track users and does not link data with third-party data for
advertising. Ads are served non-personalized (requestNonPersonalizedAdsOnly).
App Privacy labels have been updated to declare no tracking.

Regarding the 2.1(a) launch crash in build 11: the crash was caused by a
call to requestTrackingAuthorization while NSUserTrackingUsageDescription
was absent from Info.plist. All ATT code has been removed and the app
launches cleanly on iPhone and iPad.

OCR uses on-device text recognition (Apple Vision). No image or text
leaves the device. To test: Scan tab > scan or import a document
containing text > tap OCR.
```

### 4. Test before submitting

Install the production build on a **physical device** via TestFlight and confirm:

- [ ] Launches without crashing — **iPhone and iPad** (Apple reviewed on both)
- [ ] No ATT prompt appears anywhere
- [ ] OCR returns real text from a printed page
- [ ] Copy Text actually pastes into another app
- [ ] Home screen name matches the App Store listing
- [ ] Rotate to landscape on iPad — `orientation` is `"default"`, so all orientations must work
