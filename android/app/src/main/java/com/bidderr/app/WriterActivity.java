package com.bidderr.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

/**
 * The floating writer. Opened by "Write proposal" in Android's text-selection menu (or by the
 * B bubble). It shows only a small bubble at the bottom of the screen, over the job page:
 * "Writing proposal..." (sound 1) -> "Proposal ready" (sound 2), then closes by itself.
 * The work is done by assets/writer.html with the shared proposal engine.
 */
public class WriterActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";

    private WebView web;
    private String pendingText;
    private boolean pageReady;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        float dp = getResources().getDisplayMetrics().density;

        // Only a strip at the bottom; taps above it go straight through to the job page.
        Window window = getWindow();
        window.setGravity(Gravity.BOTTOM);
        window.setLayout(WindowManager.LayoutParams.MATCH_PARENT, (int) (150 * dp));
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // same saved key + prompt as the main app
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false); // the two short sounds

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost()); // never navigate away
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                deliver();
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");

        pendingText = textFrom(getIntent());
        web.loadUrl("https://" + HOST + "/assets/writer.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        pendingText = textFrom(intent);
        deliver();
    }

    private static String textFrom(Intent intent) {
        if (intent == null) return null;
        CharSequence text = Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())
                ? intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
                : intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        return text == null ? null : text.toString();
    }

    private void deliver() {
        if (!pageReady || pendingText == null) return;
        web.evaluateJavascript("window.startWriting(" + JSONObject.quote(pendingText) + ")", null);
        pendingText = null;
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private class Bridge {
        @JavascriptInterface
        public void copy(String text) {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("Proposal", text));
        }

        // Tells the B bubble (if it is turned on) what is happening: writing | ready | idle.
        @JavascriptInterface
        public void bubble(String state, String proposal) {
            BubbleService.signal(state, proposal);
        }

        @JavascriptInterface
        public boolean isBubbleOn() {
            return BubbleService.isRunning() && !BubbleService.isPaused(WriterActivity.this);
        }

        // Same encrypted API keys as the main app (see SecretStore).
        @JavascriptInterface
        public String getSecret(String name) {
            return SecretStore.get(WriterActivity.this, name);
        }

        @JavascriptInterface
        public boolean setSecret(String name, String value) {
            return SecretStore.set(WriterActivity.this, name, value);
        }

        @JavascriptInterface
        public void close() {
            runOnUiThread(() -> finish());
        }

        // For problems the user has to fix in the app (no API key yet).
        @JavascriptInterface
        public void openApp() {
            runOnUiThread(() -> {
                startActivity(new Intent(WriterActivity.this, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                finish();
            });
        }
    }
}
