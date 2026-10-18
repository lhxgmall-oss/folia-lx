package top.izuna.foliamajor.lx;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Capacitor's WebView client, plus: the audio URLs an LX source script handed out and the platforms'
 * cover images are fetched natively (OkHttp, redirects followed, Range passed through) and answered with
 * CORS headers. Folia's audio element and its cover color reading are crossorigin="anonymous" (Web Audio,
 * canvas), and these servers send no CORS headers; this is the Android side of electron/lx/mediaCors.cjs.
 */
public class LxWebViewClient extends BridgeWebViewClient {

    public LxWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String scheme = uri.getScheme();
        if (("http".equals(scheme) || "https".equals(scheme)) && !"localhost".equals(uri.getHost())) {
            String url = uri.toString();
            if (LxMediaPolicy.isIssuedMedia(url) || LxMediaPolicy.isCoverHost(uri.getHost())) {
                WebResourceResponse proxied = proxy(request, url);
                if (proxied != null) return proxied;
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    private static Map<String, String> corsHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        headers.put("Access-Control-Allow-Headers", "*");
        headers.put("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
        return headers;
    }

    private static String reasonOf(int code, String message) {
        if (message != null && !message.trim().isEmpty()) return message;
        switch (code) {
            case 200: return "OK";
            case 204: return "No Content";
            case 206: return "Partial Content";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 416: return "Range Not Satisfiable";
            default: return code < 400 ? "OK" : "Error";
        }
    }

    private static WebResourceResponse failure(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, corsHeaders(), new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse proxy(WebResourceRequest request, String url) {
        String method = request.getMethod() == null ? "GET" : request.getMethod().toUpperCase(Locale.ROOT);
        if (method.equals("OPTIONS")) return failure(204, "No Content");
        if (!method.equals("GET") && !method.equals("HEAD")) return null;

        Request.Builder builder = new Request.Builder().url(url).method(method, null);
        Map<String, String> requestHeaders = request.getRequestHeaders();
        if (requestHeaders != null) {
            for (Map.Entry<String, String> header : requestHeaders.entrySet()) {
                String name = header.getKey();
                if (name == null || header.getValue() == null) continue;
                String lower = name.toLowerCase(Locale.ROOT);
                // The page's origin means nothing to these servers (some refuse foreign referers), and
                // OkHttp negotiates and decodes the transfer encoding itself.
                if (lower.equals("origin") || lower.equals("referer") || lower.equals("accept-encoding")
                    || lower.equals("host") || lower.equals("connection") || lower.equals("cookie")) continue;
                builder.header(name, header.getValue());
            }
        }

        Response response;
        try {
            response = LxHttp.client().newCall(builder.build()).execute();
        } catch (Exception e) {
            return failure(502, "Bad Gateway");
        }
        int code = response.code();
        if (code >= 300 && code < 400) {
            response.close();
            return failure(502, "Bad Gateway");
        }
        ResponseBody body = response.body();
        Map<String, String> headers = corsHeaders();
        for (String name : response.headers().names()) {
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.startsWith("access-control-") || lower.equals("content-encoding") || lower.equals("transfer-encoding")
                || lower.equals("connection") || lower.equals("set-cookie") || lower.equals("content-security-policy")) continue;
            headers.put(name, response.header(name));
        }
        String mime = "application/octet-stream";
        String charset = null;
        if (body != null) {
            MediaType type = body.contentType();
            if (type != null) {
                mime = type.type() + "/" + type.subtype();
                if (type.charset() != null) charset = type.charset().name();
            }
        }
        InputStream data = body != null ? body.byteStream() : new ByteArrayInputStream(new byte[0]);
        try {
            return new WebResourceResponse(mime, charset, code, reasonOf(code, response.message()), headers, data);
        } catch (IllegalArgumentException e) {
            response.close();
            return failure(502, "Bad Gateway");
        }
    }
}
