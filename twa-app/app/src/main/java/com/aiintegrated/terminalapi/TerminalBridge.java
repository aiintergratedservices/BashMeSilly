package com.aiintegrated.terminalapi;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

/**
 * Bridge exposed to the WebView as {@code window.Android}. Every method is
 * annotated {@link JavascriptInterface} and may be called from the bundled JS.
 *
 * Security note: only trusted, bundled assets are ever loaded into the WebView
 * (no remote or file:// content), so exposing this interface does not widen the
 * attack surface to third-party pages.
 */
public class TerminalBridge {

    private static final String TERMUX_PACKAGE = "com.termux";
    private static final String TERMUX_SERVICE = "com.termux.app.RunCommandService";
    private static final String ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND";
    private static final String EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH";
    private static final String EXTRA_COMMAND_ARGS = "com.termux.RUN_COMMAND_ARGUMENTS";
    private static final String EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND";
    private static final String EXTRA_SESSION_ACTION = "com.termux.RUN_COMMAND_SESSION_ACTION";
    private static final String BASH_PATH = "/data/data/com.termux/files/usr/bin/bash";

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;

    TerminalBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    /** True when the genuine Termux app (package com.termux) is installed. */
    @JavascriptInterface
    public boolean isTermuxInstalled() {
        try {
            context.getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /**
     * Ask Termux to run {@code command} via `bash -c`. When {@code background}
     * is false the command runs in a visible Termux session so the user can see
     * server output; when true it runs headless.
     *
     * Requires Termux installed with `allow-external-apps=true` and the
     * com.termux.permission.RUN_COMMAND permission granted.
     */
    @JavascriptInterface
    public boolean runInTermux(String command, boolean background) {
        if (command == null || command.trim().isEmpty()) {
            return false;
        }
        try {
            Intent intent = new Intent();
            intent.setClassName(TERMUX_PACKAGE, TERMUX_SERVICE);
            intent.setAction(ACTION_RUN_COMMAND);
            intent.putExtra(EXTRA_COMMAND_PATH, BASH_PATH);
            intent.putExtra(EXTRA_COMMAND_ARGS, new String[]{"-c", command});
            intent.putExtra(EXTRA_BACKGROUND, background);
            // "0" = open/attach a foreground terminal session.
            intent.putExtra(EXTRA_SESSION_ACTION, "0");

            // RunCommandService promotes itself to a foreground service, so on
            // Android O+ it must be started as one.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            return true;
        } catch (Exception e) {
            toast("Couldn't reach Termux. Is it installed with allow-external-apps=true? "
                    + e.getMessage());
            return false;
        }
    }

    /** Bring the Termux app to the foreground, if installed. */
    @JavascriptInterface
    public boolean openTermux() {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(TERMUX_PACKAGE);
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(launch);
            return true;
        }
        toast("Termux is not installed.");
        return false;
    }

    /**
     * Acquire a partial CPU wakelock so background work (e.g. a Termux server)
     * keeps running with the screen off. Reference counting is disabled so a
     * single release() always frees it.
     */
    @JavascriptInterface
    @SuppressWarnings("WakelockTimeout")
    public boolean acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (wakeLock == null) {
                wakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK, "Terminalapi::ServerWakeLock");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) {
                wakeLock.acquire();
            }
            return true;
        } catch (Exception e) {
            toast("Wakelock error: " + e.getMessage());
            return false;
        }
    }

    /** Release the CPU wakelock if held. */
    @JavascriptInterface
    public void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {
            // Nothing actionable if release fails.
        }
    }

    @JavascriptInterface
    public boolean isWakeLockHeld() {
        return wakeLock != null && wakeLock.isHeld();
    }

    @JavascriptInterface
    public void copyToClipboard(String text) {
        ClipboardManager cm =
                (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) {
            cm.setPrimaryClip(ClipData.newPlainText("Terminalapi", text == null ? "" : text));
        }
    }

    @JavascriptInterface
    public void toast(final String message) {
        mainHandler.post(() ->
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show());
    }
}
