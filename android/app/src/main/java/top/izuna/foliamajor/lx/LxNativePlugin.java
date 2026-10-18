package top.izuna.foliamajor.lx;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.MediaType;

/**
 * Native HTTP for the LX core running in the WebView (capacitor/lx/lxHttpMobile.js): no CORS, any header,
 * redirects left to the caller (needle-like, as electron/lx/lxHttp.cjs), body in and out as base64.
 * Also takes the audio URLs LxWebViewClient may answer with CORS headers (registerMedia).
 */
@CapacitorPlugin(name = "LxNative")
public class LxNativePlugin extends Plugin {

    private static final int MAX_BODY_BYTES = 25 * 1024 * 1024;
    private final Map<Integer, Call> calls = new ConcurrentHashMap<>();

    @PluginMethod
    public void request(final PluginCall call) {
        final int id = call.getInt("id", 0);
        String url = call.getString("url");
        String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        JSObject headers = call.getObject("headers", new JSObject());
        String bodyBase64 = call.getString("bodyBase64");
        int timeout = Math.max(1000, Math.min(call.getInt("timeout", 15000), 60000));

        Request built;
        try {
            Request.Builder builder = new Request.Builder().url(url);
            if (headers != null) {
                Iterator<String> names = headers.keys();
                while (names.hasNext()) {
                    String name = names.next();
                    String value = headers.getString(name);
                    if (value != null) builder.header(name, value);
                }
            }
            RequestBody body = null;
            if (!method.equals("GET") && !method.equals("HEAD")) {
                byte[] bytes = bodyBase64 != null ? Base64.decode(bodyBase64, Base64.DEFAULT) : null;
                if (bytes != null || method.equals("POST") || method.equals("PUT") || method.equals("PATCH")) {
                    // No media type: the caller's own Content-Type header is the one sent.
                    body = RequestBody.create(bytes != null ? bytes : new byte[0], (MediaType) null);
                }
            }
            builder.method(method, body);
            built = builder.build();
        } catch (Exception e) {
            call.reject("Invalid request: " + e.getMessage(), "EINVAL");
            return;
        }

        OkHttpClient client = LxHttp.client().newBuilder()
            .followRedirects(false)
            .followSslRedirects(false)
            .callTimeout(timeout, TimeUnit.MILLISECONDS)
            .build();
        Call httpCall = client.newCall(built);
        calls.put(id, httpCall);
        httpCall.enqueue(new Callback() {
            @Override
            public void onFailure(Call failed, IOException e) {
                calls.remove(id);
                call.reject(e.getMessage() == null ? e.toString() : e.getMessage(), codeOf(failed, e));
            }

            @Override
            public void onResponse(Call done, Response response) {
                calls.remove(id);
                try (ResponseBody body = response.body()) {
                    byte[] bytes = new byte[0];
                    if (body != null) {
                        long length = body.contentLength();
                        if (length > MAX_BODY_BYTES) {
                            call.reject("Response too large", "E2BIG");
                            return;
                        }
                        bytes = body.bytes();
                        if (bytes.length > MAX_BODY_BYTES) {
                            call.reject("Response too large", "E2BIG");
                            return;
                        }
                    }
                    JSObject result = new JSObject();
                    result.put("status", response.code());
                    result.put("statusText", response.message());
                    result.put("url", response.request().url().toString());
                    JSObject outHeaders = new JSObject();
                    for (String name : response.headers().names()) {
                        List<String> values = response.headers(name);
                        String lower = name.toLowerCase(Locale.ROOT);
                        if (values.size() == 1 && !lower.equals("set-cookie")) {
                            outHeaders.put(lower, values.get(0));
                        } else {
                            JSArray all = new JSArray();
                            for (String value : values) all.put(value);
                            outHeaders.put(lower, all);
                        }
                    }
                    result.put("headers", outHeaders);
                    result.put("bodyBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    call.resolve(result);
                } catch (IOException e) {
                    call.reject(e.getMessage() == null ? e.toString() : e.getMessage(), codeOf(done, e));
                }
            }
        });
    }

    @PluginMethod
    public void abort(PluginCall call) {
        Call httpCall = calls.remove(call.getInt("id", 0));
        if (httpCall != null) httpCall.cancel();
        call.resolve();
    }

    @PluginMethod
    public void registerMedia(PluginCall call) {
        LxMediaPolicy.register(call.getString("url"));
        call.resolve();
    }

    private static String codeOf(Call httpCall, IOException e) {
        if (httpCall != null && httpCall.isCanceled()) return "ECANCELLED";
        if (e instanceof SocketTimeoutException) return "ETIMEDOUT";
        if (e instanceof InterruptedIOException) return "ETIMEDOUT";
        if (e instanceof UnknownHostException) return "ENOTFOUND";
        if (e instanceof ConnectException) return "ECONNREFUSED";
        return "ECONNRESET";
    }
}
