// A small demo wardrobe drawn as flat-lay SVGs, so the app can be explored before adding real clothes.
import { getState, putImage, saveItems, uid } from "./db";
import type { Item } from "./types";

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

const wrap = (body: string, c: string, pattern = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 220">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(c, 0.06)}"/><stop offset="1" stop-color="${shade(c, -0.08)}"/></linearGradient>${pattern}</defs>
<g stroke="${shade(c, -0.18)}" stroke-width="1.5" stroke-linejoin="round" fill="url(#g)">${body}</g></svg>`;

const check = (c: string) => `<pattern id="p" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="${c}"/><path d="M0 7h14M7 0v14" stroke="${shade(c, -0.25)}" stroke-width="2.4" opacity=".55"/><path d="M0 2h14M2 0v14" stroke="${shade(c, 0.3)}" stroke-width="1" opacity=".5"/></pattern>`;
const stripe = (c: string) => `<pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="${c}"/><rect y="0" width="12" height="5" fill="${shade(c, -0.55)}"/></pattern>`;

const SHAPES: Record<string, (c: string) => string> = {
  tee: (c) => wrap(`<path d="M70 28 L46 36 L14 64 L32 92 L52 80 L52 196 L148 196 L148 80 L168 92 L186 64 L154 36 L130 28 C124 42 76 42 70 28Z"/><path d="M76 30 C84 44 116 44 124 30" fill="none"/>`, c),
  turtleneck: (c) => wrap(`<path d="M78 14 L122 14 L124 36 L156 44 L188 140 L166 148 L146 96 L146 204 L54 204 L54 96 L34 148 L12 140 L44 44 L76 36Z"/><path d="M78 26 H122 M78 34 H122" fill="none" opacity=".5"/><path d="M54 192 H146" fill="none" opacity=".4"/>`, c),
  shirt: (c) => wrap(`<path d="M76 22 L100 34 L124 22 L156 36 L190 140 L170 148 L148 92 L148 204 L52 204 L52 92 L30 148 L10 140 L44 36Z"/><path d="M76 22 L90 50 L100 34 L110 50 L124 22" fill="${shade(c, 0.08)}"/><path d="M100 34 V204" fill="none"/><circle cx="104" cy="70" r="2" fill="${shade(c, -0.3)}"/><circle cx="104" cy="100" r="2" fill="${shade(c, -0.3)}"/><circle cx="104" cy="130" r="2" fill="${shade(c, -0.3)}"/><circle cx="104" cy="160" r="2" fill="${shade(c, -0.3)}"/>`, c),
  cardigan: (c) => wrap(`<path d="M72 18 L100 120 L128 18 L158 34 L192 150 L170 158 L148 100 L148 206 L52 206 L52 100 L30 158 L8 150 L42 34Z"/><path d="M100 120 V206" fill="none"/><circle cx="94" cy="140" r="2.4" fill="${shade(c, -0.35)}"/><circle cx="94" cy="166" r="2.4" fill="${shade(c, -0.35)}"/><circle cx="94" cy="190" r="2.4" fill="${shade(c, -0.35)}"/><path d="M52 194 H148" fill="none" opacity=".4"/>`, c),
  hoodie: (c) => wrap(`<path d="M70 26 C70 0 130 0 130 26 L158 40 L190 150 L168 158 L148 100 L148 204 L52 204 L52 100 L32 158 L10 150 L42 40Z"/><path d="M78 30 C84 54 116 54 122 30" fill="${shade(c, -0.1)}"/><path d="M72 150 H128 L120 182 H80Z" fill="none"/>`, c),
  jeans: (c) => wrap(`<path d="M50 10 H150 L162 210 H112 L100 74 L88 210 H38Z"/><path d="M50 22 H150" fill="none"/><path d="M60 22 C64 48 78 52 92 52 M140 22 C136 48 122 52 108 52" fill="none" opacity=".6"/><path d="M100 22 V74" fill="none"/>`, c),
  trousers: (c) => wrap(`<path d="M54 10 H146 L166 212 H114 L100 66 L86 212 H34Z"/><path d="M54 22 H146" fill="none"/><path d="M76 26 L64 212 M124 26 L136 212" fill="none" opacity=".35"/>`, c),
  skirt: (c) => wrap(`<path d="M58 30 H142 L176 196 H24Z"/><path d="M58 44 H142" fill="none"/>`, c, check(c)).replace('fill="url(#g)"', 'fill="url(#p)"'),
  dress: (c) => wrap(`<path d="M78 10 L86 10 L92 56 L108 56 L114 10 L122 10 L130 64 C128 90 118 104 120 112 L170 212 H30 L80 112 C82 104 72 90 70 64Z"/><path d="M80 112 H120" fill="none" opacity=".5"/>`, c),
  blazer: (c) => wrap(`<path d="M74 16 L100 36 L126 16 L160 32 L192 160 L170 168 L150 104 L152 212 L48 212 L50 104 L30 168 L8 160 L40 32Z"/><path d="M74 16 L88 92 L100 120 L112 92 L126 16" fill="${shade(c, -0.06)}"/><path d="M100 120 V212" fill="none"/><circle cx="96" cy="150" r="3" fill="${shade(c, -0.35)}"/><path d="M58 160 H84 M116 160 H142" fill="none"/>`, c, check(c)).replace('fill="url(#g)"', 'fill="url(#p)"'),
  coat: (c) => wrap(`<path d="M70 12 L100 30 L130 12 L162 28 L194 176 L172 182 L152 112 L156 216 L44 216 L48 112 L28 182 L6 176 L38 28Z"/><path d="M70 12 L84 70 L100 96 L116 70 L130 12" fill="${shade(c, -0.07)}"/><path d="M108 96 V216" fill="none"/><circle cx="118" cy="120" r="3" fill="${shade(c, -0.3)}"/><circle cx="118" cy="150" r="3" fill="${shade(c, -0.3)}"/><circle cx="84" cy="120" r="3" fill="${shade(c, -0.3)}"/><circle cx="84" cy="150" r="3" fill="${shade(c, -0.3)}"/>`, c),
  sneakers: (c) => wrap(`<g transform="translate(6 40)"><path d="M10 96 C10 70 30 58 52 56 L76 30 C96 36 110 52 120 66 C150 72 176 82 180 104 L180 116 L10 116Z"/><path d="M10 104 H180 V118 H10Z" fill="${shade(c, -0.08)}"/><path d="M64 52 L90 70 M72 44 L98 62 M80 38 L104 56" fill="none"/></g><g transform="translate(16 2) scale(.8)" opacity=".9"><path d="M10 96 C10 70 30 58 52 56 L76 30 C96 36 110 52 120 66 C150 72 176 82 180 104 L180 116 L10 116Z"/></g>`, c),
  boots: (c) => wrap(`<path d="M40 14 H96 V126 C120 130 150 140 156 168 V190 H40Z"/><path d="M40 190 H156 V204 H40Z" fill="${shade(c, -0.12)}"/><path d="M58 40 C62 56 74 56 78 40" fill="${shade(c, -0.15)}"/><path d="M110 22 H160 V130 C176 134 192 144 194 164 V184 H110Z" opacity=".75"/>`, c),
  loafers: (c) => wrap(`<g transform="rotate(-12 100 110)"><path d="M20 120 C20 96 40 84 70 82 L130 80 C160 80 184 96 184 116 C184 132 170 140 150 140 H40 C28 140 20 132 20 120Z"/><path d="M80 86 C96 104 140 104 150 86" fill="none"/><path d="M96 96 H134" fill="none"/><path d="M20 122 H184" fill="none" opacity=".4"/></g><g transform="translate(-6 -56) rotate(-12 100 110)" opacity=".8"><path d="M20 120 C20 96 40 84 70 82 L130 80 C160 80 184 96 184 116 C184 132 170 140 150 140 H40 C28 140 20 132 20 120Z"/></g>`, c),
  shoulderbag: (c) => wrap(`<path d="M62 92 C56 30 144 30 138 92" fill="none" stroke-width="7"/><path d="M40 92 H160 L168 196 H32Z"/><path d="M40 92 H160 L156 132 H44Z" fill="${shade(c, 0.06)}"/><rect x="94" y="126" width="12" height="8" rx="2" fill="#c9a24a" stroke="none"/>`, c),
  tote: (c) => wrap(`<path d="M70 70 C70 20 130 20 130 70" fill="none" stroke-width="6"/><path d="M30 70 H170 L160 206 H40Z"/><path d="M30 70 H170" fill="none"/>`, c),
  cap: (c) => wrap(`<path d="M40 130 C40 70 160 70 160 130Z"/><path d="M100 70 V130" fill="none" opacity=".5"/><path d="M40 130 C80 120 150 120 196 146 C150 150 80 146 40 130Z" fill="${shade(c, -0.08)}"/>`, c),
  scarf: (c) => wrap(`<path d="M60 20 H140 V60 C140 80 120 84 110 96 L118 206 H86 L90 96 C80 84 60 80 60 60Z"/><path d="M86 196 V212 M94 196 V212 M102 196 V212 M110 196 V212" fill="none"/>`, c, check(c)).replace('fill="url(#g)"', 'fill="url(#p)"'),
  stripedtee: (c) => wrap(`<path d="M70 28 L46 36 L14 64 L32 92 L52 80 L52 196 L148 196 L148 80 L168 92 L186 64 L154 36 L130 28 C124 42 76 42 70 28Z"/>`, c, stripe(c)).replace('fill="url(#g)"', 'fill="url(#p)"'),
};

type Seed = Omit<Item, "id" | "createdAt" | "status" | "favorite" | "tags" | "sample" | "imageId"> & { shape: string };

const SEEDS: Seed[] = [
  { shape: "turtleneck", name: "Olive merino turtleneck", category: "top", subcategory: "Sweater", colors: ["#6b7a3f"], pattern: "solid", material: "Merino", seasons: ["autumn", "winter"], occasions: ["casual", "work", "smart"], formality: 3, warmth: 4, price: 3200 },
  { shape: "cardigan", name: "Chocolate rib cardigan", category: "top", subcategory: "Cardigan", colors: ["#5a3424"], pattern: "textured", material: "Wool blend", seasons: ["autumn", "winter", "spring"], occasions: ["casual", "work"], formality: 3, warmth: 3, price: 2800 },
  { shape: "tee", name: "Heavyweight white tee", category: "top", subcategory: "T-shirt", colors: ["#f5f4ef"], pattern: "solid", material: "Cotton", seasons: [], occasions: ["casual", "lounge"], formality: 1, warmth: 2, price: 900 },
  { shape: "stripedtee", name: "Breton stripe top", category: "top", subcategory: "T-shirt", colors: ["#f2efe6", "#1f2a44"], pattern: "striped", material: "Cotton", seasons: ["spring", "summer", "autumn"], occasions: ["casual"], formality: 2, warmth: 2, price: 1500 },
  { shape: "shirt", name: "Light blue oxford shirt", category: "top", subcategory: "Shirt", colors: ["#a9c4e2"], pattern: "solid", material: "Cotton", seasons: [], occasions: ["work", "smart", "casual"], formality: 3, warmth: 2, price: 2200 },
  { shape: "hoodie", name: "Grey marl hoodie", category: "top", subcategory: "Hoodie", colors: ["#9a9a98"], pattern: "solid", material: "Jersey", seasons: ["autumn", "winter", "spring"], occasions: ["casual", "lounge", "sport"], formality: 1, warmth: 3, price: 1800 },
  { shape: "jeans", name: "Straight dark jeans", category: "bottom", subcategory: "Jeans", colors: ["#2c3a52"], pattern: "solid", material: "Denim", seasons: [], occasions: ["casual", "party"], formality: 2, warmth: 3, price: 2900 },
  { shape: "trousers", name: "Black tailored trousers", category: "bottom", subcategory: "Trousers", colors: ["#151515"], pattern: "solid", material: "Wool", seasons: [], occasions: ["work", "smart", "party"], formality: 4, warmth: 3, price: 3500 },
  { shape: "trousers", name: "Stone wide chinos", category: "bottom", subcategory: "Chinos", colors: ["#cdbb98"], pattern: "solid", material: "Cotton twill", seasons: ["spring", "summer", "autumn"], occasions: ["casual", "work"], formality: 3, warmth: 2, price: 2400 },
  { shape: "skirt", name: "Bottle-green check skirt", category: "bottom", subcategory: "Skirt", colors: ["#1f3d33"], pattern: "checked", material: "Tweed", seasons: ["autumn", "winter"], occasions: ["work", "smart"], formality: 3, warmth: 3, price: 2600 },
  { shape: "dress", name: "Black slip dress", category: "dress", subcategory: "Dress", colors: ["#141414"], pattern: "solid", material: "Satin", seasons: ["spring", "summer", "autumn"], occasions: ["party", "smart"], formality: 4, warmth: 1, price: 4200 },
  { shape: "coat", name: "Camel wool coat", category: "outerwear", subcategory: "Coat", colors: ["#b88a55"], pattern: "solid", material: "Wool", seasons: ["autumn", "winter"], occasions: ["casual", "work", "smart", "party"], formality: 4, warmth: 5, price: 9800 },
  { shape: "blazer", name: "Houndstooth blazer", category: "outerwear", subcategory: "Blazer", colors: ["#8a7a62"], pattern: "checked", material: "Wool", seasons: ["autumn", "winter", "spring"], occasions: ["work", "smart"], formality: 4, warmth: 3, price: 5600 },
  { shape: "coat", name: "Olive trench", category: "outerwear", subcategory: "Trench", colors: ["#596037"], pattern: "solid", material: "Cotton gabardine", seasons: ["spring", "autumn"], occasions: ["casual", "work", "smart"], formality: 3, warmth: 3, price: 7400 },
  { shape: "sneakers", name: "White leather sneakers", category: "shoes", subcategory: "Sneakers", colors: ["#f3f2ee"], pattern: "solid", material: "Leather", seasons: [], occasions: ["casual", "sport"], formality: 2, warmth: 2, price: 4500 },
  { shape: "boots", name: "Black chelsea boots", category: "shoes", subcategory: "Boots", colors: ["#121212"], pattern: "solid", material: "Leather", seasons: ["autumn", "winter", "spring"], occasions: ["casual", "work", "smart", "party"], formality: 3, warmth: 4, price: 6200 },
  { shape: "loafers", name: "Brown penny loafers", category: "shoes", subcategory: "Loafers", colors: ["#5b3320"], pattern: "solid", material: "Leather", seasons: ["spring", "summer", "autumn"], occasions: ["work", "smart", "casual"], formality: 4, warmth: 2, price: 5200 },
  { shape: "shoulderbag", name: "Black shoulder bag", category: "bag", subcategory: "Shoulder bag", colors: ["#16181f"], pattern: "solid", material: "Leather", seasons: [], occasions: ["work", "smart", "party", "casual"], formality: 4, warmth: 1, price: 6800 },
  { shape: "tote", name: "Canvas tote", category: "bag", subcategory: "Tote", colors: ["#e3d8c0"], pattern: "solid", material: "Canvas", seasons: [], occasions: ["casual"], formality: 1, warmth: 1, price: 700 },
  { shape: "scarf", name: "Tartan wool scarf", category: "accessory", subcategory: "Scarf", colors: ["#7a2a2a"], pattern: "checked", material: "Wool", seasons: ["autumn", "winter"], occasions: ["casual", "work"], formality: 3, warmth: 4, price: 1600 },
  { shape: "cap", name: "Navy baseball cap", category: "accessory", subcategory: "Cap", colors: ["#1f2a44"], pattern: "solid", material: "Cotton", seasons: ["spring", "summer"], occasions: ["casual", "sport"], formality: 1, warmth: 1, price: 900 },
];

export function sampleSvg(shape: string, color: string) {
  return (SHAPES[shape] || SHAPES.tee)(color);
}

export async function loadSampleWardrobe() {
  const now = Date.now();
  const cur = getState().settings.currency;
  // Seed prices are in rupees; convert roughly so the demo numbers look sensible elsewhere.
  const rate = cur === "₹" ? 1 : cur === "¥" ? 1.8 : 1 / 85;
  const items: Item[] = [];
  for (let k = 0; k < SEEDS.length; k++) {
    const { shape, ...seed } = SEEDS[k];
    const svg = sampleSvg(shape, seed.colors[0]);
    const imageId = await putImage(new Blob([svg], { type: "image/svg+xml" }));
    items.push({ ...seed, price: seed.price ? Math.max(5, Math.round((seed.price * rate) / 5) * 5) : undefined, id: uid(), imageId, status: "owned", favorite: k % 7 === 0, tags: [], sample: true, createdAt: now - k * 1000 });
  }
  await saveItems(items);
  return items;
}
