package com.aiintegrated.terminalapi;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/**
 * Hosts the bundled UI (assets/index.html) inside a WebView and wires up the
 * native {@link TerminalBridge} so the web layer can drive real Android
 * capabilities: launching servers in Termux, holding a CPU wakelock, and
 * clipboard access.
 *
 * The in-app terminal is a self-contained learning sandbox (it does not run a
 * real shell). Real command/server execution is delegated to Termux via the
 * "Servers" tab. Assets are served over https://appassets.androidplatform.net
 * through WebViewAssetLoader so file access can stay disabled.
 */
public class MainActivity extends Activity {

    private static final String BASE_URL =
            "https://appassets.androidplatform.net/assets/index.html";

    private WebView webView;
    private TerminalBridge bridge;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Honor the page's <meta viewport> (width=device-width) so the UI is
        // laid out at the device's CSS width and scaled correctly, instead of
        // the WebView's 980px desktop default. LoadWithOverviewMode fits the
        // initial layout to the screen.
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        // Assets ship inside the APK; never serve a stale cached copy after an update.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // Everything is bundled/served via the asset loader; no filesystem or
        // remote content is ever loaded.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        bridge = new TerminalBridge(this);
        webView.addJavascriptInterface(bridge, "Android");

        webView.loadUrl(BASE_URL);
        setContentView(webView);
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) {
            bridge.releaseWakeLock();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
