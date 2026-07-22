# Terminalapi

A beginner-friendly Android app for learning bash and launching your project
servers — the friendly control panel, with **Termux** as the real engine.

It has four tabs:

- **Terminal** — an interactive learning shell in a safe sandbox (nothing here
  touches your phone). Turn on **Explain mode** and it describes every command,
  flag, and argument as you run it.
- **Learn** — step-by-step guided bash lessons that check each command you type.
- **Servers** — save your project launch commands and run them *for real* in
  Termux with one tap, plus copy-to-clipboard.
- **Help** — one-time Termux setup and fixes for common phone issues.

There's also a real **wakelock** toggle (a native Android `PARTIAL_WAKE_LOCK`)
so servers keep running with the screen off.

> **Why Termux?** A sandboxed WebView app can't run a real shell or real
> servers — only Termux ships a full Linux userland that can. So this app
> teaches bash and acts as a launcher/control panel, and hands real commands to
> Termux via its `RUN_COMMAND` intent.

## Get the app (sideloadable APK)

Every push builds a debug APK in GitHub Actions:

1. Open the **Actions** tab → the latest **Build APK** run.
2. Download the **terminalapi-debug-apk** artifact and unzip it.
3. Copy `app-debug.apk` to your phone and install it (enable "install unknown
   apps" for your browser/file manager first).

## Set up Termux (needed for the Servers tab)

1. Install **Termux** and **Termux:API** from **F-Droid** or
   **github.com/termux/termux-app/releases** — *never* the Play Store version,
   and both from the *same* source.
2. In Termux, allow this app to send it commands:
   ```
   echo "allow-external-apps=true" >> ~/.termux/termux.properties
   ```

The in-app **Help** tab also covers fixing a slow package mirror
(`termux-change-repo`) and stopping Android from killing background servers.

## Build locally

Requires JDK 17 and the Android SDK (with `platforms;android-35`).

```
cd twa-app
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

## Project layout

```
twa-app/                     Android app (Gradle)
  app/src/main/
    java/.../MainActivity.java   WebView host
    java/.../TerminalBridge.java native bridge: Termux, wakelock, clipboard
    assets/                      the UI (index.html, styles.css, app.js)
    AndroidManifest.xml
.github/workflows/build-apk.yml  CI that builds the APK
```
