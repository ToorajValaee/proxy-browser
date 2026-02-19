// Cloudflare Pages Function: Proxies ANY URL through Cloudflare edge servers
// Route: /p/:target  where :target is encodeURIComponent(fullUrl)

export async function onRequest(context) {
  const { request, params } = context;

  let APP_VERSION = "0.0.0";
  const targetParam = params?.target;

  if (!targetParam) {
    return new Response("Missing target URL", { status: 400 });
  }

  const targetUrl = decodeURIComponent(targetParam);

  // Prevent infinite recursion (proxying our own site)
  const origin = new URL(request.url).origin;
  if (targetUrl.startsWith(origin)) {
    return new Response("Refusing to proxy this origin (loop protection).", { status: 400 });
  }

  try {
    // Try to read the deployed VERSION file so headers reflect the repo VERSION
    try {
      const vres = await fetch(origin + "/VERSION");
      if (vres?.ok) APP_VERSION = (await vres.text()).trim() || APP_VERSION;
    } catch {}

    // Build outgoing headers (don’t forward host/cookies)
    const outgoingHeaders = new Headers();
    for (const [k, v] of request.headers) {
      const key = k.toLowerCase();
      if (["host", "cookie", "content-length"].includes(key)) continue;
      outgoingHeaders.set(k, v);
    }
    if (!outgoingHeaders.has("user-agent")) {
      outgoingHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    }
    if (!outgoingHeaders.has("accept")) outgoingHeaders.set("Accept", "*/*");
    outgoingHeaders.set("Referer", targetUrl);

    // OPTIONS preflight support
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(APP_VERSION),
      });
    }

    const proxyReq = new Request(targetUrl, {
      method: request.method,
      headers: outgoingHeaders,
      body: request.body,
      redirect: "follow",
    });

    const fetched = await fetch(proxyReq);
    const fetchedUrl = fetched.url || "";
    const contentType = (fetched.headers.get("Content-Type") || "").toLowerCase();

    // HTML rewrite
    if (contentType.startsWith("text/html") || contentType.includes("xml")) {
      const proxyBase = origin + "/p/";
      const transformed = htmlRewriter(proxyBase, targetUrl).transform(fetched);

      const headers = new Headers(transformed.headers);
      headers.set("X-Proxy-Target", targetUrl);
      headers.set("X-Proxy-Request-URL", proxyReq.url);
      headers.set("X-Fetched-URL", fetchedUrl);
      headers.set("X-App-Version", APP_VERSION);

      // allow embedding
      headers.delete("x-frame-options");
      headers.delete("content-security-policy");
      headers.delete("content-security-policy-report-only");

      // CORS
      applyCors(headers, APP_VERSION);

      return new Response(transformed.body, {
        status: transformed.status,
        statusText: transformed.statusText,
        headers,
      });
    }

    // Non-HTML assets passthrough
    const headers = new Headers(fetched.headers);
    headers.set("X-Proxy-Target", targetUrl);
    headers.set("X-Proxy-Request-URL", proxyReq.url);
    headers.set("X-Fetched-URL", fetchedUrl);
    headers.set("X-App-Version", APP_VERSION);
    headers.delete("x-frame-options");
    applyCors(headers, APP_VERSION);

    return new Response(fetched.body, {
      status: fetched.status,
      statusText: fetched.statusText,
      headers,
    });
  } catch (error) {
    return new Response(`Proxy failed: ${error?.message}\n\nTarget: ${targetUrl}`, { status: 502 });
  }
}

function corsHeaders(appVersion) {
  const h = new Headers();
  applyCors(h, appVersion);
  return h;
}

function applyCors(headers, appVersion) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");
  headers.set("X-App-Version", appVersion);
}

// HTML Rewriter: Rewrite links/src to proxy
function htmlRewriter(proxyBase, baseUrl) {
  return new HTMLRewriter()
    .on('a[href], link[href], script[src], img[src], source[src], embed[src], iframe[src], form[action]', {
      element(element) {
        let attr = null;
        if (element.tagName === "form") attr = "action";
        else if (element.getAttribute("href") !== null) attr = "href";
        else if (element.getAttribute("src") !== null) attr = "src";
        if (!attr) return;

        const value = element.getAttribute(attr);
        if (!value) return;

        try {
          const url = new URL(value, baseUrl);
          element.setAttribute(attr, proxyBase + encodeURIComponent(url.href));
        } catch {}
      },
    })
    .on("*[style]", {
      element(element) {
        const style = element.getAttribute("style") || "";
        element.setAttribute("style", rewriteStyleUrls(style, proxyBase, baseUrl));
      },
    })
    .on('meta[http-equiv="Content-Security-Policy"], meta[http-equiv="content-security-policy"]', {
      element(element) {
        element.remove();
      },
    })
    .on("base[href]", {
      element(element) {
        element.remove();
      },
    });
}

function rewriteStyleUrls(style, proxyBase, baseUrl) {
  return style.replace(/url\([^)]*\)/g, (match) => {
    const urlMatch = match.match(/url\(["']?([^"')]+)["']?\)/);
    if (urlMatch) {
      try {
        const resolved = new URL(urlMatch[1], baseUrl);
        return `url(${proxyBase}${encodeURIComponent(resolved.href)})`;
      } catch {}
    }
    return match;
  });
}
