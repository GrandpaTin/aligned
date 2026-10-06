package com.grandpatin.aligned;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Offline Android shell for Aligned.
 *
 * The bundled web app (assets/www) is served under the public site address so that
 * localStorage, the QR join links and the pairing service's origin check all behave
 * exactly like the hosted game. Nothing under that path is fetched from the network;
 * only the pairing service (two-phone play) needs a connection.
 */
public class MainActivity extends Activity {
    static final String SITE_HOST = "grandpatin.github.io";
    static final String SITE_PATH = "/aligned/";
    static final String HOME_URL = "https://" + SITE_HOST + SITE_PATH;
    private static final int FILE_CHOOSER_REQUEST = 41;
    private static final int SAVE_FILE_REQUEST = 42;

    private WebView web;
    private ValueCallback<Uri[]> pendingFileCallback;
    private byte[] pendingSaveBytes;
    private String pendingSaveName;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0F172A);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AlignedAndroid/" + appVersion());

        web.setWebViewClient(new AppClient());
        web.setWebChromeClient(new AppChromeClient());
        web.addJavascriptInterface(new Bridge(), "AlignedAndroid");
        setContentView(web);

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(startUrl(getIntent()));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent.getData();
        if (data == null) return;
        if (isAppUri(data)) web.loadUrl(startUrl(intent));
        else openExternally(data);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // The game decides what Back means (close a dialog, return home); otherwise leave the app.
        web.evaluateJavascript("(function(){try{return !!(window.alignedHandleBack&&window.alignedHandleBack());}catch(e){return false;}})()", result -> {
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            pendingFileCallback = null;
            return;
        }
        if (requestCode == SAVE_FILE_REQUEST) {
            byte[] bytes = pendingSaveBytes;
            String name = pendingSaveName;
            pendingSaveBytes = null;
            Uri target = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || target == null || bytes == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(target)) {
                if (out == null) throw new IOException("Location unavailable");
                out.write(bytes);
                Toast.makeText(this, "Saved " + name, Toast.LENGTH_LONG).show();
            } catch (IOException error) {
                Toast.makeText(this, "Could not save the file.", Toast.LENGTH_LONG).show();
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data != null && isAppUri(data)) {
            String fragment = data.getEncodedFragment();
            return HOME_URL + (fragment == null ? "" : "#" + fragment);
        }
        return HOME_URL;
    }

    static boolean isAppUri(Uri uri) {
        String path = uri.getPath() == null ? "" : uri.getPath();
        // Downloads (a newer APK, the offline copy) always come from the live site, never the bundled assets.
        return "https".equals(uri.getScheme()) && SITE_HOST.equalsIgnoreCase(uri.getHost())
            && (path.equals("/aligned") || path.startsWith(SITE_PATH))
            && !path.startsWith(SITE_PATH + "downloads/");
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception error) {
            return "1";
        }
    }

    private final class AppClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isAppUri(uri)) return null;
            String path = uri.getPath() == null ? "" : uri.getPath();
            String relative = path.length() <= SITE_PATH.length() ? "index.html" : path.substring(SITE_PATH.length());
            if (relative.isEmpty() || relative.endsWith("/")) relative += "index.html";
            if (relative.contains("..")) return notFound();
            try {
                InputStream stream = getAssets().open("www/" + relative);
                String mime = mimeType(relative);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                headers.put("X-Content-Type-Options", "nosniff");
                boolean textual = mime.startsWith("text/") || mime.contains("json");
                WebResourceResponse response = new WebResourceResponse(mime, textual ? "utf-8" : null, stream);
                response.setResponseHeaders(headers);
                return response;
            } catch (IOException missing) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isAppUri(uri)) return false;
            openExternally(uri);
            return true;
        }

        private WebResourceResponse notFound() {
            WebResourceResponse response = new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
            response.setStatusCodeAndReasonPhrase(404, "Not Found");
            return response;
        }
    }

    private final class AppChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = callback;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(intent, "Choose a backup"), FILE_CHOOSER_REQUEST);
                return true;
            } catch (ActivityNotFoundException error) {
                pendingFileCallback = null;
                return false;
            }
        }
    }

    private void openExternally(Uri uri) {
        Intent view = new Intent(Intent.ACTION_VIEW, uri);
        if (SITE_HOST.equalsIgnoreCase(uri.getHost())) {
            // Links on the game's own site (e.g. an update download) must go to a browser, never back to this app.
            ResolveInfo browser = getPackageManager().resolveActivity(
                new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/")), PackageManager.MATCH_DEFAULT_ONLY);
            String browserPackage = browser == null || browser.activityInfo == null ? null : browser.activityInfo.packageName;
            if (browserPackage != null && !"android".equals(browserPackage) && !getPackageName().equals(browserPackage)) {
                view.setPackage(browserPackage);
            } else {
                Intent chooser = Intent.createChooser(view, "Open with");
                chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, new ComponentName[] { new ComponentName(this, MainActivity.class) });
                view = chooser;
            }
        }
        try {
            startActivity(view);
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No app can open that link.", Toast.LENGTH_SHORT).show();
        }
    }

    static String mimeType(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    /** Native helpers the web app uses where an Android WebView has no browser equivalent. */
    private final class Bridge {
        @JavascriptInterface
        public String version() {
            return appVersion();
        }

        @JavascriptInterface
        public boolean saveFile(String fileName, String mimeType, String base64) {
            String safeName = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (target == null) throw new IOException("No download location");
                    try (OutputStream out = getContentResolver().openOutputStream(target)) {
                        if (out == null) throw new IOException("Download location unavailable");
                        out.write(bytes);
                    }
                } else {
                    // Before Android 10 there is no permission-free Downloads folder, so let the person pick
                    // where the backup goes with the system "save as" screen.
                    pendingSaveBytes = bytes;
                    pendingSaveName = safeName;
                    runOnUiThread(() -> {
                        Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        create.addCategory(Intent.CATEGORY_OPENABLE);
                        create.setType(mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
                        create.putExtra(Intent.EXTRA_TITLE, safeName);
                        try {
                            startActivityForResult(create, SAVE_FILE_REQUEST);
                        } catch (ActivityNotFoundException error) {
                            pendingSaveBytes = null;
                            Toast.makeText(MainActivity.this, "No app is available to save files.", Toast.LENGTH_LONG).show();
                        }
                    });
                    return true;
                }
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Saved " + safeName + " to Downloads", Toast.LENGTH_LONG).show());
                return true;
            } catch (IOException error) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Could not save the file.", Toast.LENGTH_LONG).show());
                return false;
            }
        }

        @JavascriptInterface
        public void share(String title, String text, String url) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_SUBJECT, title);
                send.putExtra(Intent.EXTRA_TEXT, (text == null || text.isEmpty() ? "" : text + "\n") + url);
                startActivity(Intent.createChooser(send, title));
            });
        }

        @JavascriptInterface
        public boolean copyText(String text) {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard == null) return false;
            clipboard.setPrimaryClip(ClipData.newPlainText("Aligned", text));
            return true;
        }

        @JavascriptInterface
        public void openExternal(String url) {
            runOnUiThread(() -> openExternally(Uri.parse(url)));
        }

        /** Matches the system bars to the game's visual theme (light themes get dark icons). */
        @JavascriptInterface
        public void setSystemBars(String color, boolean lightBackground) {
            runOnUiThread(() -> {
                int parsed;
                try {
                    parsed = android.graphics.Color.parseColor(color);
                } catch (IllegalArgumentException error) {
                    return;
                }
                getWindow().setStatusBarColor(parsed);
                getWindow().setNavigationBarColor(parsed);
                web.setBackgroundColor(parsed);
                int flags = getWindow().getDecorView().getSystemUiVisibility();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags = lightBackground ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    flags = lightBackground ? flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
                getWindow().getDecorView().setSystemUiVisibility(flags);
            });
        }
    }
}
