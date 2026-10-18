package top.izuna.foliamajor.lx;

import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;

/** The one OkHttp client of the app (connection pool shared by LxNativePlugin and LxWebViewClient). */
final class LxHttp {

    private static volatile OkHttpClient client;

    private LxHttp() {}

    static OkHttpClient client() {
        OkHttpClient current = client;
        if (current == null) {
            synchronized (LxHttp.class) {
                current = client;
                if (current == null) {
                    current = new OkHttpClient.Builder()
                        .connectTimeout(20, TimeUnit.SECONDS)
                        .readTimeout(60, TimeUnit.SECONDS)
                        .writeTimeout(60, TimeUnit.SECONDS)
                        .followRedirects(true)
                        .followSslRedirects(true)
                        .retryOnConnectionFailure(true)
                        .build();
                    client = current;
                }
            }
        }
        return current;
    }
}
