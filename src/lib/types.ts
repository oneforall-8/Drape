export const CATEGORIES = ["top", "bottom", "dress", "outerwear", "shoes", "bag", "accessory"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  top: "Tops",
  bottom: "Bottoms",
  dress: "Dresses & sets",
  outerwear: "Outerwear",
  shoes: "Shoes",
  bag: "Bags",
  accessory: "Accessories",
};

export const SUBCATEGORIES: Record<Category, string[]> = {
  top: ["T-shirt", "Shirt", "Blouse", "Polo", "Tank", "Sweater", "Cardigan", "Hoodie", "Sweatshirt", "Kurta", "Top"],
  bottom: ["Jeans", "Trousers", "Chinos", "Shorts", "Skirt", "Joggers", "Leggings", "Cargo"],
  dress: ["Dress", "Jumpsuit", "Co-ord set", "Suit", "Saree", "Kurta set"],
  outerwear: ["Jacket", "Blazer", "Coat", "Trench", "Puffer", "Raincoat", "Gilet", "Overshirt"],
  shoes: ["Sneakers", "Boots", "Loafers", "Sandals", "Heels", "Flats", "Trainers", "Derbies"],
  bag: ["Tote", "Backpack", "Crossbody", "Clutch", "Shoulder bag"],
  accessory: ["Hat", "Cap", "Scarf", "Belt", "Sunglasses", "Watch", "Jewellery", "Tie"],
};

/** Tops that are worn over another top (used for layering). */
export const MID_LAYERS = ["sweater", "cardigan", "hoodie", "sweatshirt", "overshirt"];

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export const OCCASIONS = ["casual", "work", "smart", "party", "sport", "lounge"] as const;
export type Occasion = (typeof OCCASIONS)[number];
export const OCCASION_LABEL: Record<Occasion, string> = {
  casual: "Casual",
  work: "Work",
  smart: "Smart / dinner",
  party: "Going out",
  sport: "Active",
  lounge: "Lounge",
};

export const PATTERNS = ["solid", "striped", "checked", "floral", "graphic", "print", "textured"] as const;
export type Pattern = (typeof PATTERNS)[number];

export type ItemStatus = "owned" | "wishlist" | "archived";

export interface Item {
  id: string;
  name: string;
  category: Category;
  subcategory?: string;
  colors: string[]; // hex, most dominant first
  pattern: Pattern;
  material?: string;
  seasons: Season[]; // empty = all seasons
  occasions: Occasion[]; // empty = casual
  formality: number; // 1 (very casual) … 5 (formal)
  warmth: number; // 1 (very light) … 5 (very warm)
  brand?: string;
  price?: number;
  size?: string;
  sourceUrl?: string;
  imageId?: string; // key in the images store (local blob)
  imageUrl?: string; // remote image fallback when the blob couldn't be saved
  originalImageId?: string; // photo before background removal / replacement
  status: ItemStatus;
  favorite: boolean;
  tags: string[];
  notes?: string;
  sample?: boolean;
  createdAt: number;
  updatedAt?: number;
}

export interface LayoutSlot {
  itemId: string;
  x: number; // 0..1 centre, relative to board
  y: number;
  w: number; // 0..1 width relative to board
  r: number; // rotation deg
  z: number;
}

export interface Outfit {
  id: string;
  name: string;
  itemIds: string[];
  layout?: LayoutSlot[];
  occasion?: Occasion;
  favorite: boolean;
  source: "manual" | "rules" | "ai";
  notes?: string;
  createdAt: number;
  updatedAt?: number;
}

/** One entry per day: planned or worn outfit. */
export interface DayEntry {
  date: string; // YYYY-MM-DD
  itemIds: string[];
  outfitId?: string;
  worn: boolean;
  note?: string;
  updatedAt?: number;
}

export type Provider = "gemini" | "openrouter" | "claude" | "custom";

export interface Settings {
  provider?: Provider;
  apiKey?: string; // Claude key (kept under this name for older saves)
  keys?: Partial<Record<Provider, string>>; // keys for the other providers
  models?: Partial<Record<Provider, { vision?: string; text?: string }>>;
  customBase?: string;
  model: string; // Claude model
  autoRemoveBg: boolean;
  autoTag: boolean;
  location?: { name: string; lat: number; lon: number };
  units: "c" | "f";
  currency: string;
  proxyUrl?: string;
  driveClientId?: string;
  driveConnected?: boolean;
  lastSync?: number;
  theme: "system" | "light" | "dark";
  aiCostNote?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  model: "claude-opus-5-5",
  autoRemoveBg: true,
  autoTag: true,
  units: "c",
  currency: "₹",
  theme: "light",
};
