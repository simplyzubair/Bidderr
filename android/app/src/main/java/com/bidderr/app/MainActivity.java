package com.bidderr.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

/**
 * Shows the Bidderr page (assets/index.html) in a WebView. The page does the real work with the
 * shared proposal engine; this class only passes in text from "Write proposal" / Share and
 * gives the page clipboard access.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";

    private WebView web;
    private String pendingText;
    private boolean pageReady;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        // Serve assets from an https origin so the page can call the Google API.
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
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                // Any other link (like the Google key page) opens in the normal browser.
                startActivity(new Intent(Intent.ACTION_VIEW, url));
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                deliverPendingText();
            }
        });

        // Needed so confirm() dialogs (like "Reset to default") show up.
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        pendingText = textFromIntent(getIntent());
        web.loadUrl("https://" + HOST + "/assets/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        pendingText = textFromIntent(intent);
        deliverPendingText();
    }

    private static String textFromIntent(Intent intent) {
        if (intent == null) return null;
        CharSequence text = null;
        if (Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        }
        return text == null ? null : text.toString();
    }

    private void deliverPendingText() {
        if (!pageReady || pendingText == null) return;
        web.evaluateJavascript("window.onJobText(" + JSONObject.quote(pendingText) + ")", null);
        pendingText = null;
    }

    private class Bridge {
        @JavascriptInterface
        public void copy(String text) {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("Proposal", text));
        }

        @JavascriptInterface
        public String paste() {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) return "";
            CharSequence text = clip.getItemAt(0).coerceToText(MainActivity.this);
            return text == null ? "" : text.toString();
        }
    }
}
