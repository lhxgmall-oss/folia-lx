package top.izuna.foliamajor.lx;

import java.net.URI;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * What the page may read cross-origin through LxWebViewClient, as electron/lx/mediaCors.cjs does on
 * desktop: the audio URLs a source script handed out (registered by the LX core, exact URL, for two
 * hours), and covers from the five platforms' image hosts.
 */
final class LxMediaPolicy {

    private static final String[] COVER_HOST_SUFFIXES = {
        ".kuwo.cn", ".kwcdn.kuwo.cn", ".kugou.com", ".kgimg.com", ".gtimg.cn", ".music.126.net", ".126.net", ".migu.cn",
        // Qishui (capacitor/qishui): its public image CDNs, as electron/qishui/mediaCors.cjs.
        ".byteimg.com", ".douyinpic.com", ".douyinstatic.com", ".pstatp.com",
    };
    private static final long TTL_MS = 2L * 60L * 60L * 1000L;
    private static final int MAX_ENTRIES = 2048;
    private static final Map<String, Long> ISSUED = new LinkedHashMap<>();

    private LxMediaPolicy() {}

    /** The URL without its fragment, or null when it is not a plain http(s) URL. */
    static String normalize(String value) {
        if (value == null) return null;
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return null;
            if (uri.getRawUserInfo() != null) return null;
            int hash = value.indexOf('#');
            return hash >= 0 ? value.substring(0, hash) : value;
        } catch (Exception e) {
            int hash = value.indexOf('#');
            String bare = hash >= 0 ? value.substring(0, hash) : value;
            return bare.startsWith("http://") || bare.startsWith("https://") ? bare : null;
        }
    }

    static synchronized void register(String value) {
        String url = normalize(value);
        if (url == null) return;
        ISSUED.remove(url);
        ISSUED.put(url, System.currentTimeMillis() + TTL_MS);
        while (ISSUED.size() > MAX_ENTRIES) {
            Iterator<String> oldest = ISSUED.keySet().iterator();
            oldest.next();
            oldest.remove();
        }
    }

    static synchronized boolean isIssuedMedia(String value) {
        String url = normalize(value);
        if (url == null) return false;
        Long expiry = ISSUED.get(url);
        if (expiry == null) return false;
        if (expiry > System.currentTimeMillis()) return true;
        ISSUED.remove(url);
        return false;
    }

    static boolean isCoverHost(String host) {
        if (host == null) return false;
        String lower = host.toLowerCase(Locale.ROOT);
        for (String suffix : COVER_HOST_SUFFIXES) {
            if (lower.endsWith(suffix)) return true;
        }
        return false;
    }
}
