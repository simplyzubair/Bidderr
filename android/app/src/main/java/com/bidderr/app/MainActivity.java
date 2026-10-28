package com.bidderr.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Shows the Bidderr page (assets/index.html) in a WebView. The page does the real work with the
 * shared proposal engine; this class passes in text from the bubble, "Write proposal" or Share,
 * and gives the page clipboard access and app updates.
 */
public class MainActivity extends Activity {
    public static final String ACTION_FROM_BUBBLE = "com.bidderr.app.FROM_BUBBLE";
    private static final String HOST = "appassets.androidplatform.net";
    // Updates are only ever downloaded from this project's GitHub releases.
    private static final String UPDATE_PREFIX = "https://github.com/simplyzubair/Bidderr/releases/download/";

    private WebView web;
    private String pendingText;
    private boolean pendingFromBubble;
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
        readIntent(getIntent());
        web.loadUrl("https://" + HOST + "/assets/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readIntent(intent);
        deliverPendingText();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // The user may come back from the Accessibility or "unknown apps" settings.
        if (pageReady) web.evaluateJavascript("window.onAppResumed && window.onAppResumed()", null);
    }

    private void readIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        CharSequence text = null;
        if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        } else if (Intent.ACTION_SEND.equals(action) || ACTION_FROM_BUBBLE.equals(action)) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        }
        if (text == null) return;
        pendingText = text.toString();
        pendingFromBubble = ACTION_FROM_BUBBLE.equals(action);
    }

    private void deliverPendingText() {
        if (!pageReady || pendingText == null) return;
        web.evaluateJavascript("window.onJobText(" + JSONObject.quote(pendingText) + ", "
                + pendingFromBubble + ")", null);
        pendingText = null;
    }

    private void callPage(String function, String value) {
        runOnUiThread(() -> web.evaluateJavascript(
                "window." + function + " && window." + function + "(" + JSONObject.quote(value) + ")", null));
    }

    private boolean bubbleEnabled() {
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        String me = new ComponentName(this, BubbleService.class).flattenToString();
        TextUtils.SimpleStringSplitter split = new TextUtils.SimpleStringSplitter(':');
        split.setString(enabled);
        for (String s : split) if (s.equalsIgnoreCase(me)) return true;
        return false;
    }

    private void downloadAndInstall(String url) {
        try {
            File dir = new File(getCacheDir(), "updates");
            dir.mkdirs();
            File apk = new File(dir, "Bidderr.apk");
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(60000);
            if (conn.getResponseCode() != 200) throw new Exception("HTTP " + conn.getResponseCode());
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".updates", apk);
            startActivity(new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK));
            callPage("onUpdateStatus", "started");
        } catch (Exception e) {
            callPage("onUpdateStatus", "failed");
        }
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

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "0.0.0";
            }
        }

        // After a bubble proposal: tell the user, then go straight back to the job page.
        @JavascriptInterface
        public void backToJob() {
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, "Proposal copied. Tap the box and paste.", Toast.LENGTH_LONG).show();
                moveTaskToBack(true);
            });
        }

        @JavascriptInterface
        public boolean isBubbleOn() {
            return bubbleEnabled();
        }

        @JavascriptInterface
        public void openBubbleSettings() {
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        }

        @JavascriptInterface
        public void installUpdate(String url) {
            if (url == null || !url.startsWith(UPDATE_PREFIX) || !url.endsWith(".apk")) {
                callPage("onUpdateStatus", "failed");
                return;
            }
            // Android 8+ asks once per app for "Install unknown apps".
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())));
                callPage("onUpdateStatus", "needs_permission");
                return;
            }
            callPage("onUpdateStatus", "downloading");
            new Thread(() -> downloadAndInstall(url)).start();
        }
    }
}
