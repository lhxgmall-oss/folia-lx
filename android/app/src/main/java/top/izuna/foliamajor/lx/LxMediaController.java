package top.izuna.foliamajor.lx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.media.session.MediaButtonReceiver;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * One MediaSession for the app: the notification / lock-screen / quick-settings player and media
 * buttons. State comes from the page (LxMediaPlugin), button presses go back to it (Listener).
 */
public final class LxMediaController {

    public interface Listener {
        void onAction(String action, double seekTime);
    }

    public static final class State {
        final String title, artist, album, artwork, state;
        final double position, duration;
        final float rate;
        final Set<String> actions;

        State(String title, String artist, String album, String artwork, String state,
              double position, double duration, float rate, Set<String> actions) {
            this.title = title == null ? "" : title;
            this.artist = artist == null ? "" : artist;
            this.album = album == null ? "" : album;
            this.artwork = artwork == null ? "" : artwork;
            this.state = state == null ? "none" : state;
            this.position = position;
            this.duration = duration;
            this.rate = rate > 0 ? rate : 1f;
            this.actions = actions == null ? Collections.emptySet() : actions;
        }
    }

    static final int NOTIFICATION_ID = 4107;
    // "folia_playback" (v0.2.5-0.2.7) was IMPORTANCE_LOW, which some skins file under silent / folded.
    static final String CHANNEL_ID = "folia_playback_v2";
    private static LxMediaController instance;

    private final Context context;
    private final MediaSessionCompat session;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).build();
    private Listener listener;
    private State current;
    private String artworkUrl = "";
    private Bitmap artwork;
    private boolean serviceStarted;
    int updates;
    String lastError = "";

    State current() { return current; }
    boolean sessionActive() { return session.isActive(); }

    public static synchronized LxMediaController get(Context context) {
        if (instance == null) instance = new LxMediaController(context.getApplicationContext());
        return instance;
    }

    private LxMediaController(Context context) {
        this.context = context;
        session = new MediaSessionCompat(context, "FoliaLX");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { emit("play", -1); }
            @Override public void onPause() { emit("pause", -1); }
            @Override public void onSkipToNext() { emit("nexttrack", -1); }
            @Override public void onSkipToPrevious() { emit("previoustrack", -1); }
            @Override public void onStop() { emit("pause", -1); }
            @Override public void onSeekTo(long pos) { emit("seekto", pos / 1000d); }
        });
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "播放控制", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.deleteNotificationChannel("folia_playback");
                manager.createNotificationChannel(channel);
            }
        }
    }

    MediaSessionCompat getSession() { return session; }

    void setListener(Listener listener) { this.listener = listener; }

    boolean isPlaying() { return current != null && "playing".equals(current.state); }

    private void emit(String action, double seekTime) {
        Listener target = listener;
        if (target != null) main.post(() -> target.onAction(action, seekTime));
    }

    void update(State state) {
        main.post(() -> apply(state));
    }

    private void apply(State state) {
        updates++;
        current = state;
        if ("none".equals(state.state) || state.title.isEmpty()) {
            clear(context);
            return;
        }
        if (!state.artwork.equals(artworkUrl)) {
            artworkUrl = state.artwork;
            artwork = null;
            loadArtwork(state.artwork);
        }
        publishSession();
        LxPlaybackService service = LxPlaybackService.running;
        if (service != null) {
            service.refresh();
        } else {
            startService();
        }
    }

    private void publishSession() {
        State s = current;
        if (s == null) return;
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, s.duration > 0 ? (long) (s.duration * 1000) : -1);
        if (artwork != null) meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(meta.build());

        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_SEEK_TO;
        if (s.actions.contains("nexttrack")) actions |= PlaybackStateCompat.ACTION_SKIP_TO_NEXT;
        if (s.actions.contains("previoustrack")) actions |= PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS;
        int playback = isPlaying() ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(playback, (long) (Math.max(0, s.position) * 1000), isPlaying() ? s.rate : 0f)
            .build());
        session.setActive(true);
    }

    private void startService() {
        Intent intent = new Intent(context, LxPlaybackService.class).setAction(LxPlaybackService.ACTION_REFRESH);
        try {
            ContextCompat.startForegroundService(context, intent);
            serviceStarted = true;
        } catch (RuntimeException error) {
            // Not allowed from the background right now: show the notification without the service.
            lastError = "startForegroundService: " + error;
            postNotification(context);
        }
    }

    Notification buildNotification(Context ctx) {
        State s = current;
        if (s == null || "none".equals(s.state) || s.title.isEmpty()) return null;
        boolean playing = isPlaying();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_folia)
            .setContentTitle(s.title)
            .setContentText(s.artist)
            .setSubText(s.album.isEmpty() ? null : s.album)
            .setLargeIcon(artwork)
            .setContentIntent(session.getController().getSessionActivity())
            .setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(ctx, PlaybackStateCompat.ACTION_STOP))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(playing)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT);
        builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_previous, "上一首",
            MediaButtonReceiver.buildMediaButtonPendingIntent(ctx, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)));
        builder.addAction(playing
            ? new NotificationCompat.Action(android.R.drawable.ic_media_pause, "暂停",
                MediaButtonReceiver.buildMediaButtonPendingIntent(ctx, PlaybackStateCompat.ACTION_PAUSE))
            : new NotificationCompat.Action(android.R.drawable.ic_media_play, "播放",
                MediaButtonReceiver.buildMediaButtonPendingIntent(ctx, PlaybackStateCompat.ACTION_PLAY)));
        builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_next, "下一首",
            MediaButtonReceiver.buildMediaButtonPendingIntent(ctx, PlaybackStateCompat.ACTION_SKIP_TO_NEXT)));
        builder.setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
            .setMediaSession(session.getSessionToken())
            .setShowActionsInCompactView(0, 1, 2));
        return builder.build();
    }

    void postNotification(Context ctx) {
        Notification notification = buildNotification(ctx);
        if (notification == null) return;
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, notification);
        } catch (SecurityException ignored) {
            lastError = "notify: no permission";
            // No notification permission (Android 13+): the session still drives the system player.
        }
    }

    void clear(Context ctx) {
        current = null;
        session.setActive(false);
        NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID);
        serviceStarted = false;
        if (LxPlaybackService.running != null) {
            ctx.stopService(new Intent(ctx, LxPlaybackService.class));
        }
    }

    private void loadArtwork(String url) {
        if (url == null || !(url.startsWith("http") || url.startsWith("data:"))) return;
        new Thread(() -> {
            Bitmap bitmap = null;
            if (url.startsWith("data:")) {
                try {
                    int comma = url.indexOf(',');
                    byte[] bytes = android.util.Base64.decode(url.substring(comma + 1), android.util.Base64.DEFAULT);
                    bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                } catch (Exception ignored) {
                    // Bad data: no cover.
                }
            } else try (Response response = http.newCall(new Request.Builder().url(url).build()).execute()) {
                ResponseBody body = response.body();
                if (response.isSuccessful() && body != null) {
                    byte[] bytes = body.bytes();
                    BitmapFactory.Options bounds = new BitmapFactory.Options();
                    bounds.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                    BitmapFactory.Options options = new BitmapFactory.Options();
                    int sample = 1;
                    while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 512) sample *= 2;
                    options.inSampleSize = sample;
                    bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                }
            } catch (Exception ignored) {
                // No cover: the notification shows without one.
            }
            final Bitmap loaded = bitmap;
            main.post(() -> {
                if (loaded == null || !url.equals(artworkUrl) || current == null) return;
                artwork = loaded;
                publishSession();
                LxPlaybackService service = LxPlaybackService.running;
                if (service != null) service.refresh(); else postNotification(context);
            });
        }, "lx-artwork").start();
    }
}
