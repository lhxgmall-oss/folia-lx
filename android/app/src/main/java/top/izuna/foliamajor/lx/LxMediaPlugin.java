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

    @PluginMethod
    public void status(PluginCall call) {
        android.content.Context ctx = getContext();
        LxMediaController controller = LxMediaController.get(ctx);
        JSObject out = new JSObject();
        out.put("sdk", android.os.Build.VERSION.SDK_INT);
        boolean permission = android.os.Build.VERSION.SDK_INT < 33
            || androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
        out.put("permission", permission);
        out.put("notificationsEnabled", androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        int importance = -1;
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            android.app.NotificationManager manager = ctx.getSystemService(android.app.NotificationManager.class);
            android.app.NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(LxMediaController.CHANNEL_ID);
            if (channel != null) importance = channel.getImportance();
        }
        out.put("channelImportance", importance);
        out.put("updates", controller.updates);
        LxMediaController.State state = controller.current();
        out.put("lastTitle", state == null ? "" : state.title);
        out.put("lastState", state == null ? "none" : state.state);
        out.put("serviceRunning", LxPlaybackService.running != null);
        out.put("sessionActive", controller.sessionActive());
        out.put("lastError", controller.lastError);
        call.resolve(out);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        android.app.Activity activity = getActivity();
        if (android.os.Build.VERSION.SDK_INT < 33 || activity == null
            || androidx.core.content.ContextCompat.checkSelfPermission(activity, android.Manifest.permission.POST_NOTIFICATIONS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            JSObject out = new JSObject();
            out.put("granted", androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
            call.resolve(out);
            return;
        }
        activity.runOnUiThread(() -> androidx.core.app.ActivityCompat.requestPermissions(
            activity, new String[] { android.Manifest.permission.POST_NOTIFICATIONS }, 4108));
        JSObject out = new JSObject();
        out.put("granted", false);
        call.resolve(out);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        android.content.Context ctx = getContext();
        android.content.Intent intent;
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            intent = new android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        } else {
            intent = new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.parse("package:" + ctx.getPackageName()));
        }
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(intent);
        } catch (RuntimeException e) {
            ctx.startActivity(new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.parse("package:" + ctx.getPackageName())).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    /** A plain notification, to tell "notifications are blocked" apart from "the media player is not shown". */
    @PluginMethod
    public void testNotification(PluginCall call) {
        android.content.Context ctx = getContext();
        android.app.Notification n = new androidx.core.app.NotificationCompat.Builder(ctx, LxMediaController.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_folia)
            .setContentTitle("Folia LX 测试通知")
            .setContentText("看到这条说明通知权限正常")
            .setAutoCancel(true)
            .build();
        try {
            androidx.core.app.NotificationManagerCompat.from(ctx).notify(4109, n);
            call.resolve();
        } catch (SecurityException e) {
            call.reject("没有通知权限");
        }
    }
}
