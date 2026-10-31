// Optional free helper for Drape, deployed as a Cloudflare Worker (free plan: 100k requests/day).
// Only needed if the built-in free page reader can't read a shop you use.
//
//   GET /meta?url=<product page>  -> { title, description, image, price, brand }
//   GET /image?url=<image url>    -> the image, with CORS headers so Drape can save it offline
//
// Deploy: dash.cloudflare.com → Workers & Pages → Create → "Hello World" worker →
// replace the code with this file → Deploy → paste the worker's URL into Drape › Settings › Link helper.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const u = new URL(req.url);
    const target = u.searchParams.get("url");
    if (!target || !/^https?:\/\//.test(target)) return json({ error: "Pass ?url=https://…" }, 400);

    if (u.pathname === "/image") {
      const r = await fetch(target, { headers: { "User-Agent": UA, Referer: new URL(target).origin } });
      const type = r.headers.get("content-type") || "";
      if (!r.ok || !type.startsWith("image/")) return json({ error: "Not an image" }, 502);
      return new Response(r.body, { headers: { ...CORS, "Content-Type": type, "Cache-Control": "public, max-age=86400" } });
    }

    if (u.pathname === "/meta") {
      const r = await fetch(target, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
      if (!r.ok) return json({ error: `Shop returned ${r.status}` }, 502);
      const html = (await r.text()).slice(0, 600_000);
      const meta = (name) => {
        const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)`, "i"))
          || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, "i"));
        return m ? decode(m[1]) : "";
      };
      // JSON-LD product data is the most reliable source when present.
      let ld = {};
      for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
          const data = JSON.parse(m[1]);
          const list = Array.isArray(data) ? data : data["@graph"] || [data];
          const p = list.find((x) => /Product/i.test(x["@type"]));
          if (p) { ld = p; break; }
        } catch { /* ignore */ }
      }
      const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers || {};
      const ldImage = Array.isArray(ld.image) ? ld.image[0] : typeof ld.image === "object" ? ld.image?.url : ld.image;
      const image = ldImage || meta("og:image") || meta("twitter:image");
      return json({
        title: ld.name || meta("og:title") || (html.match(/<title>([^<]*)/i)?.[1] || "").trim(),
        description: ld.description || meta("og:description") || meta("description"),
        image: image ? new URL(image, target).href : "",
        price: offer.price || meta("product:price:amount") || null,
        brand: (typeof ld.brand === "object" ? ld.brand?.name : ld.brand) || meta("og:site_name") || "",
      });
    }
    return json({ ok: true, routes: ["/meta?url=", "/image?url="] });
  },
};

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
