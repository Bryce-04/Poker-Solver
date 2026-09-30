---
name: android-build
description: Use when building, syncing, or installing the Android (Capacitor) app in apps/web/android, regenerating its icon/splash assets, or getting a change onto a real device/emulator to verify it. Covers the build-sync-Gradle-install loop, the pinned Gradle version and why, and diagnosing a silent `adb install` hang (screen lock, Samsung Auto Blocker).
---

# Building and running the Android app

`apps/web/android/` is a committed native Capacitor project wrapping
`apps/web`'s build output — see the "Android (Capacitor)" section in
`apps/web/README.md` for the architecture. This skill is the mechanical
loop for actually getting a change onto a device.

## The rebuild loop

Every time `apps/web/src` changes and you need to see it on Android:

```
pnpm --filter web build              # from repo root: Vite -> dist/
cd apps/web && npx cap sync android   # copies dist/ into the native project
cd android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew.bat assembleDebug --console=plain
```

Produces `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`.
`pnpm --filter web build` (not `pnpm dev:web`) matters even for local
testing — it's what picks up `apps/web/.env.production`'s
`VITE_API_BASE_URL`, so the Android build talks to the deployed API, not
`localhost`.

**Don't skip `cap sync`** — `assembleDebug` alone rebuilds against
whatever web assets were copied in last time, silently ignoring newer
source changes.

## Why `JAVA_HOME` is pinned to Android Studio's JDK, and why the Gradle wrapper is on 9.1.0

Android Studio's bundled JDK is version 25. Capacitor's Android template
ships a Gradle wrapper pinned to 8.14.3, which cannot run on JDK 25 at
all (fails immediately with `Unsupported class file major version 69`) —
Gradle didn't add JDK 25 support until 9.1.0. If `apps/web/android/gradle/
wrapper/gradle-wrapper.properties` ever reverts to an 8.x
`distributionUrl` (e.g. from re-running `npx cap add android` or a
Capacitor upgrade), bump it back to 9.1.0+ rather than installing a
second JDK. Confirmed working pairing: JDK 25 (Android Studio's bundled
`jbr`) + Gradle 9.1.0 + AGP 8.13.0 (the template's plugin pin) — AGP
tolerates the newer Gradle fine, it was only Gradle's own bootstrap that
couldn't run on the JDK.

## Installing on a device and verifying it actually worked

```
ADB="/c/Users/wendl/AppData/Local/Android/Sdk/platform-tools/adb.exe"
"$ADB" devices -l                                    # confirm it shows "device", not "unauthorized"/nothing
"$ADB" install -r apps/web/android/app/build/outputs/apk/debug/app-debug.apk
```

**If `adb install` hangs with no output and no error** (this happened
repeatedly): don't assume it's a connection problem if `adb devices`
already shows the device as authorized. Check, in order:

1. **Phone screen is locked or asleep.** This was the actual root cause
   the times it looked like everything else was configured correctly.
   Unlock the phone and keep the screen on during the install.
2. **Samsung Auto Blocker** (Settings → Security and privacy → Auto
   Blocker) can silently block app installs via USB, separately from USB
   debugging authorization. Turn it off during active development.
3. USB mode is **File Transfer (MTP)**, not "charging only" or MIDI.

Never assume a hang means "try again" — it means one of the above is
still true.

**Verify the install actually landed and launched**, don't trust the
build/install exit code alone:

```
"$ADB" shell pm list packages | grep pokersolver          # confirms it's really installed
"$ADB" shell am start -n com.pokersolver.app/.MainActivity
"$ADB" shell dumpsys activity activities | grep mFocusedApp  # confirms it's the foreground app, not crashed to home
"$ADB" exec-out screencap -p > /tmp/check.png              # then Read the PNG — actually look at it
```

A build succeeding and an install command returning 0 are not proof the
app runs; a screenshot is.

## Regenerating the icon/splash

Source assets are hand-authored SVGs in `apps/web/assets/` (`icon-
background`, `icon-foreground`, `icon-only`, `splash`, `splash-dark`) —
not `favicon.svg` directly, since an adaptive icon needs separate
foreground/background layers. After changing any of them:

```
cd apps/web
npx capacitor-assets generate --android
```

This overwrites everything under `android/app/src/main/res/mipmap-*` and
`drawable-*` — never hand-edit those generated files. Before rebuilding
the APK, sanity-check a new icon actually looks right: composite the
foreground+background PNGs under a **circle mask** (the strictest shape a
real launcher applies) rather than trusting the flat source SVG alone —
content that looks fine square can still clip once masked.

```html
<!-- quick local check, open in a browser or headless-screenshot it -->
<div style="position:relative;width:432px;height:432px;border-radius:50%;overflow:hidden">
  <img src="android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_background.png" style="position:absolute;width:100%;height:100%">
  <img src="android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png" style="position:absolute;width:100%;height:100%">
</div>
```

## Why the frontend uses `CapacitorHttp`, not `fetch`

`apps/web/src/lib/api.ts` is built on `CapacitorHttp` (from
`@capacitor/core`, no separate package needed since v4) specifically so
Android requests route through native networking rather than the
WebView's `fetch` — this sidesteps the browser's CORS enforcement
entirely instead of needing `apps/api`'s CORS allowlist to include the
Capacitor origin. On web, `CapacitorHttp` transparently falls back to
`fetch`, so this isn't an Android-only code path to maintain separately.
