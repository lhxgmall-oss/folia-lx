package top.izuna.foliamajor.lx;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;

/**
 * The page's navigator.mediaSession, made real (src/services/android/androidMediaSession.ts): update()
 * carries metadata, state, position and the actions the page handles; buttons pressed in the
 * notification, on the lock screen or on a headset come back as "action" events.
 */
@CapacitorPlugin(name = "LxMedia")
public class LxMediaPlugin extends Plugin {

    @Override
    public void load() {
        LxMediaController.get(getContext()).setListener((action, seekTime) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            if (seekTime >= 0) data.put("seekTime", seekTime);
            notifyListeners("action", data);
        });
    }

    private boolean askedNotifications;

    /**
     * Android 13+ (and skins like MagicOS / HyperOS even for media) hide the player notification
     * until the app may post notifications: ask once, the first time something plays.
     */
    private void askNotificationPermissionOnce() {
        if (askedNotifications || android.os.Build.VERSION.SDK_INT < 33) return;
        askedNotifications = true;
        android.app.Activity activity = getActivity();
        if (activity == null) return;
        if (androidx.core.content.ContextCompat.checkSelfPermission(activity, android.Manifest.permission.POST_NOTIFICATIONS)
            == android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        activity.runOnUiThread(() -> androidx.core.app.ActivityCompat.requestPermissions(
            activity, new String[] { android.Manifest.permission.POST_NOTIFICATIONS }, 4108));
    }

    @PluginMethod
    public void update(PluginCall call) {
        Set<String> actions = new HashSet<>();
        JSArray list = call.getArray("actions", new JSArray());
        for (int i = 0; i < list.length(); i++) {
            String name = list.optString(i, null);
            if (name != null) actions.add(name);
        }
        LxMediaController.State state = new LxMediaController.State(
            call.getString("title", ""),
            call.getString("artist", ""),
            call.getString("album", ""),
            call.getString("artwork", ""),
            call.getString("state", "none"),
            call.getDouble("position", 0d),
            call.getDouble("duration", 0d),
            call.getFloat("rate", 1f),
            actions
        );
        if ("playing".equals(state.state)) askNotificationPermissionOnce();
        LxMediaController.get(getContext()).update(state);
        call.resolve();
    }
}
