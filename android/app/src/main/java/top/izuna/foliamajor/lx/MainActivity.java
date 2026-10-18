package top.izuna.foliamajor.lx;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

/**
 * Folia LX: the Folia web app in Capacitor's WebView, plus the LxNative plugin (native HTTP for the LX
 * core, see src/services/onlineMusic/lx/android/lxAndroidBridge.ts) and a WebView client that answers
 * LX audio URLs and cover images with CORS headers (LxWebViewClient).
 *
 * Edge to edge: the WebView draws under the status bar, the navigation bar and the display cutout
 * (transparent bars, light icons), so the lyric background reaches every edge. Capacitor's own
 * SystemBars insets handling is off (capacitor.config.json, insetsHandling "disable"): on WebView
 * builds before 140 it falls back to padding the whole window by the bar sizes, which is exactly the
 * black frame this replaces. Instead the bar sizes go to the page as --safe-area-inset-* (CSS px) on
 * every WebView version, and the page keeps its controls clear of them (src/index.css, --lx-safe-*).
 * Only the on-screen keyboard still shrinks the WebView, so inputs stay above it.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LxNativePlugin.class);
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this, SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // No grey scrim behind three-button navigation: the page paints that strip itself.
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#09090b"));
        Bridge bridge = getBridge();
        if (bridge != null) {
            bridge.setWebViewClient(new LxWebViewClient(bridge));
            installInsetsListener(bridge);
        }
    }

    private void installInsetsListener(Bridge bridge) {
        View decor = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            // The keyboard covers the navigation bar, so while it is up the page has no bottom inset.
            v.setPadding(0, 0, 0, keyboardVisible ? ime.bottom : 0);
            float density = getResources().getDisplayMetrics().density;
            String script = String.format(
                Locale.US,
                "(function(){var s=document.documentElement&&document.documentElement.style;if(!s)return;"
                    + "s.setProperty('--safe-area-inset-top','%.1fpx');s.setProperty('--safe-area-inset-right','%.1fpx');"
                    + "s.setProperty('--safe-area-inset-bottom','%.1fpx');s.setProperty('--safe-area-inset-left','%.1fpx');"
                    + "window.dispatchEvent(new Event('folia-safe-area'));})();",
                bars.top / density,
                bars.right / density,
                keyboardVisible ? 0f : bars.bottom / density,
                bars.left / density
            );
            lastInsetsScript = script;
            WebView webView = bridge.getWebView();
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(script, null));
            }
            // Passed on unchanged: WebView 140+ also reports them as env(safe-area-inset-*).
            return ViewCompat.onApplyWindowInsets(v, insets);
        });
        // A page (re)load starts without the custom properties; send the last known values again.
        bridge.addWebViewListener(new com.getcapacitor.WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                if (lastInsetsScript != null) {
                    view.evaluateJavascript(lastInsetsScript, null);
                }
                ViewCompat.requestApplyInsets(decor);
            }
        });
        ViewCompat.requestApplyInsets(decor);
    }

    private volatile String lastInsetsScript;
}
