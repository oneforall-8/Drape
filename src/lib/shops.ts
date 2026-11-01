// Search links for the shops on the "to buy" page. The shops don't allow apps to read their
// catalogues, so Drape opens each shop's own search for a suggested piece instead.

export type ShopRegion = "uk" | "in";
export type ShopFor = "men" | "women";

export const SHOP_REGIONS: Record<ShopRegion, string> = { uk: "UK", in: "India" };

const enc = encodeURIComponent;

export const SHOPS: { id: string; name: string; url: (q: string, region: ShopRegion, who: ShopFor) => string }[] = [
  { id: "uniqlo", name: "Uniqlo", url: (q, r, w) => `https://www.uniqlo.com/${r === "in" ? "in" : "uk"}/en/search?q=${enc(`${w} ${q}`)}` },
  { id: "zara", name: "Zara", url: (q, r, w) => `https://www.zara.com/${r === "in" ? "in" : "uk"}/en/search?searchTerm=${enc(q)}&section=${w === "women" ? "WOMAN" : "MAN"}` },
  { id: "hm", name: "H&M", url: (q, r, w) => `https://www2.hm.com/${r === "in" ? "en_in" : "en_gb"}/search-results.html?q=${enc(`${w} ${q}`)}` },
];
