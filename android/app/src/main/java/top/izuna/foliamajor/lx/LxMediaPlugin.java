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
        LxMediaController.get(getContext()).update(state);
        call.resolve();
    }
}
