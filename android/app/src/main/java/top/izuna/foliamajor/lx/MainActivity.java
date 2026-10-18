package top.izuna.foliamajor.lx;

import android.os.Bundle;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * Folia LX: the Folia web app in Capacitor's WebView, plus the LxNative plugin (native HTTP for the LX
 * core, see src/services/onlineMusic/lx/android/lxAndroidBridge.ts) and a WebView client that answers
 * LX audio URLs and cover images with CORS headers (LxWebViewClient).
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LxNativePlugin.class);
        super.onCreate(savedInstanceState);
        Bridge bridge = getBridge();
        if (bridge != null) {
            bridge.setWebViewClient(new LxWebViewClient(bridge));
        }
    }
}
