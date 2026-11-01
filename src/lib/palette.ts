// Personal colour seasons (from a personal colour analysis). Picked in Settings → Your colours and
// passed to the AI stylist as a gentle preference: best colours near the face, the rest still worn.

export interface ColorSeason { id: string; label: string; best: string; away: string; metal: string }

export const COLOR_SEASONS: ColorSeason[] = [
  { id: "spring-light", label: "Light Spring", best: "warm light colours: peach, light coral, warm aqua, buttercream, light camel, warm light grey, ivory", away: "black, deep burgundy, icy cool shades, heavy dark neutrals", metal: "gold" },
  { id: "spring-warm", label: "Warm Spring (True Spring)", best: "golden yellow, coral, tomato red, warm green, turquoise, camel, warm navy, ivory", away: "black, cool greys, icy pastels, burgundy, cool pinks", metal: "gold" },
  { id: "spring-bright", label: "Bright Spring (Clear Spring)", best: "clear bright colours: tomato red, kelly green, bright turquoise, warm pink, navy, crisp white", away: "muted dusty shades, beige on beige, khaki, mustard", metal: "gold or mixed metals" },
  { id: "summer-light", label: "Light Summer", best: "soft cool light colours: powder blue, lavender, rose pink, mint, soft grey, light navy, soft white", away: "black, orange, mustard, rust, strong brights", metal: "silver" },
  { id: "summer-cool", label: "Cool Summer (True Summer)", best: "cool soft colours: slate blue, rose, raspberry, soft teal, blue-grey, navy, soft white", away: "orange, camel, mustard, pure black, warm browns", metal: "silver" },
  { id: "summer-soft", label: "Soft Summer", best: "muted cool-neutral colours: dusty rose, soft teal, grey-blue, taupe, mushroom, sage, charcoal-blue", away: "black, bright white, neon brights, orange", metal: "silver or rose gold" },
  { id: "autumn-soft", label: "Soft Autumn", best: "muted warm colours: sage, olive, camel, dusty teal, warm taupe, soft terracotta, warm grey", away: "black, bright white, icy pastels, neon brights", metal: "gold" },
  { id: "autumn-warm", label: "Warm Autumn (True Autumn)", best: "rust, mustard, olive, camel, tomato red, teal, chocolate, cream", away: "black, icy pastels, cool pinks, cool grey", metal: "gold" },
  { id: "autumn-deep", label: "Deep Autumn (Dark Autumn)", best: "chocolate, deep olive, burgundy-brown, forest green, deep teal, rust, espresso, cream", away: "pastels, icy shades, bright cool pinks, light grey", metal: "gold or bronze" },
  { id: "winter-deep", label: "Deep Winter (Dark Winter)", best: "deep cool colours: black, charcoal, navy, deep burgundy and wine, bottle and forest green, deep teal, deep purple, very dark olive, crisp white", away: "light or dusty colours: sky blue, mint, lavender, sage, grey-blue; yellowish or warm earth colours: mustard, khaki, yellow-olive, rust, camel, beige", metal: "silver" },
  { id: "winter-cool", label: "Cool Winter (True Winter)", best: "black, pure white, royal blue, emerald, fuchsia, true red, icy pastels, charcoal", away: "orange, camel, mustard, warm browns, muted dusty shades", metal: "silver" },
  { id: "winter-bright", label: "Bright Winter (Clear Winter)", best: "black, white, vivid fuchsia, cobalt, emerald, true red, icy pastels", away: "muted dusty shades, warm earthy colours, beige, khaki", metal: "silver" },
];

/** The user's colour profile as a few lines for the AI, or "" when none is set. */
export function paletteText(s: { colorSeason?: string; colorNotes?: string }): string {
  const season = COLOR_SEASONS.find((c) => c.id === s.colorSeason);
  const lines: string[] = [];
  if (season) lines.push(`Season: ${season.label}.`, `Best colours: ${season.best}.`, `Weaker colours: ${season.away}.`, `Metal that suits them: ${season.metal}.`);
  if (s.colorNotes?.trim()) lines.push(`Their notes: ${s.colorNotes.trim()}`);
  return lines.join("\n");
}
