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
import android.webkit.WebView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import org.json.JSONObject;

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
    private WebView webView;

    TerminalBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Give the bridge a handle to the WebView so async HTTP results can be
     *  delivered back into JS. Called once from MainActivity after setup. */
    void attachWebView(WebView w) {
        this.webView = w;
    }

    /* ---------- Async HTTP to Kortana's Terminus (never blocks the WebView) ----------
     * JavascriptInterface calls are synchronous from JS's point of view, so a
     * blocking network call here would freeze the whole UI for the length of an
     * LLM reply. Instead these run on a worker thread and hand the result back
     * to JS via window.__bridgeResolve(callbackId, envelopeJson). */
    @JavascriptInterface
    public void httpPostJson(final String url, final String body, final String callbackId) {
        new Thread(() -> deliver(callbackId, doRequest("POST", url, body, 180000, null))).start();
    }

    @JavascriptInterface
    public void httpGet(final String url, final String callbackId) {
        new Thread(() -> deliver(callbackId, doRequest("GET", url, null, 8000, null))).start();
    }

    /* Keyed variants — attach x-api-key so calls to Kortana's Terminus
     * authenticate when it's hosted with a TERMINUS_API_KEY (e.g. on Render). */
    @JavascriptInterface
    public void httpPostJsonKeyed(final String url, final String body, final String apiKey, final String callbackId) {
        new Thread(() -> deliver(callbackId, doRequest("POST", url, body, 180000, apiKey))).start();
    }

    @JavascriptInterface
    public void httpGetKeyed(final String url, final String apiKey, final String callbackId) {
        new Thread(() -> deliver(callbackId, doRequest("GET", url, null, 8000, apiKey))).start();
    }

    private String doRequest(String method, String urlStr, String body, int readTimeoutMs, String apiKey) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(readTimeoutMs);
            conn.setRequestProperty("Accept", "application/json");
            if (apiKey != null && !apiKey.isEmpty()) conn.setRequestProperty("x-api-key", apiKey);
            if (body != null && !"GET".equals(method)) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                OutputStream os = conn.getOutputStream();
                os.write(body.getBytes("UTF-8"));
                os.close();
            }
            int status = conn.getResponseCode();
            boolean ok = status >= 200 && status < 300;
            InputStream is = (status >= 200 && status < 400)
                    ? conn.getInputStream() : conn.getErrorStream();
            String resp = readAll(is);
            return new JSONObject()
                    .put("ok", ok).put("status", status)
                    .put("body", resp == null ? "" : resp)
                    .toString();
        } catch (Exception e) {
            try {
                return new JSONObject().put("ok", false)
                        .put("error", String.valueOf(e.getMessage())).toString();
            } catch (Exception ignore) {
                return "{\"ok\":false,\"error\":\"request failed\"}";
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readAll(InputStream is) throws Exception {
        if (is == null) return "";
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int n;
        while ((n = is.read(chunk)) != -1) buf.write(chunk, 0, n);
        is.close();
        return buf.toString("UTF-8");
    }

    private void deliver(final String callbackId, final String envelopeJson) {
        final String js = "window.__bridgeResolve && window.__bridgeResolve("
                + JSONObject.quote(callbackId) + "," + JSONObject.quote(envelopeJson) + ");";
        mainHandler.post(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
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
