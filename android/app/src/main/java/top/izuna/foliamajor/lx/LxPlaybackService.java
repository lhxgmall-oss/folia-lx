package top.izuna.foliamajor.lx;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.ServiceCompat;
import androidx.media.session.MediaButtonReceiver;

/**
 * Foreground service that keeps the app alive while music plays in the background and holds the
 * media notification (LxMediaController builds it). Also receives headset / Bluetooth media buttons
 * through androidx MediaButtonReceiver.
 */
public class LxPlaybackService extends Service {

    static final String ACTION_REFRESH = "top.izuna.foliamajor.lx.REFRESH";
    static volatile LxPlaybackService running;

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        super.onDestroy();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        LxMediaController controller = LxMediaController.get(this);
        if (intent != null && Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction())) {
            MediaButtonReceiver.handleIntent(controller.getSession(), intent);
        }
        if (!show(true)) {
            // Started with startForegroundService but nothing plays (a media button after the app was
            // closed): Android still requires startForeground before stopping, or it kills the app.
            try {
                Notification placeholder = new androidx.core.app.NotificationCompat.Builder(this, LxMediaController.CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_folia).setContentTitle("Folia LX").build();
                int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
                ServiceCompat.startForeground(this, LxMediaController.NOTIFICATION_ID, placeholder, type);
            } catch (RuntimeException ignored) {
                // Not allowed: nothing to undo.
            }
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    /** Foreground while playing, a dismissible notification while paused. False when there is nothing to show. */
    boolean refresh() {
        return show(false);
    }

    private boolean show(boolean mustStartForeground) {
        LxMediaController controller = LxMediaController.get(this);
        Notification notification = controller.buildNotification(this);
        if (notification == null) return false;
        if (controller.isPlaying() || mustStartForeground) {
            try {
                int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
                ServiceCompat.startForeground(this, LxMediaController.NOTIFICATION_ID, notification, type);
            } catch (RuntimeException error) {
                // Android 12+ refuses to go foreground from the background without a user action; the
                // notification is still posted, just without the foreground guarantee.
                controller.postNotification(this);
            }
        }
        if (!controller.isPlaying()) {
            // Paused: the notification stays, but can be swiped away and the service may be stopped.
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
            controller.postNotification(this);
        }
        return true;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiped out of recents: the page that plays is gone, so is the player.
        LxMediaController.get(this).clear(this);
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
