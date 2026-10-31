# Drape — your digital wardrobe

A free, private wardrobe app in the spirit of Whering: photograph or link the clothes you own,
get clean cut-outs, and let Drape mix them into outfits for the weather, the day and the occasion.

It's a static website: it runs entirely in your browser, hosts free on GitHub Pages, and keeps your
wardrobe on your device. AI is optional, and the default AI options are free.

## What it does

| | Without AI (free) | With free AI (Gemini / OpenRouter) | With Claude (paid) |
|---|---|---|---|
| Add photos (bulk, camera, paste) | ✓ | ✓ | ✓ |
| Background cut-out (on-device) | ✓ | ✓ | ✓ |
| Colour detection | ✓ | ✓ | ✓ |
| Auto-tagging (type, season, formality, warmth…) | pick category yourself | ✓ | ✓ |
| Import from a shop link (name, price, photo) | ✓ basic | ✓ full details | ✓ full details |
| Find a clean product photo of something you photographed | search links + paste | search links + AI-written query | ✓ automatic shop search |
| Daily outfit suggestions (weather, occasion, colour rules, rotation) | ✓ | ✓ | ✓ |
| Lock-a-piece & shuffle, outfit builder (drag/resize flat-lay) | ✓ | ✓ | ✓ |
| Calendar: plan ahead with the 10-day forecast, log what you wore | ✓ | ✓ | ✓ |
| Insights: cost per wear, palette, most worn, forgotten pieces | ✓ | ✓ | ✓ |
| Wishlist with "goes with N of your pieces" | ✓ | ✓ | ✓ |
| Stylist chat (events, packing, gaps) | — | ✓ | ✓ |

The outfit engine (`src/lib/rules.ts`) is rule-based and needs no AI: it builds outfits from
templates (top + bottom + shoes, or dress + shoes, with layers when it's cold or wet), then scores
them on weather fit, occasion and formality, colour harmony (neutrals, tonal, analogous,
complementary, clashes), pattern mixing, and how recently you wore each piece.

## Free AI setup (2 minutes)

**Google Gemini (recommended, free):**
1. Go to <https://aistudio.google.com/apikey> and sign in with a Google account.
2. Click **Create API key** and copy it.
3. In Drape: **settings → AI → Google Gemini** → paste the key → **save**.

The free tier has daily limits that are plenty for personal use. Note that Google may use
free-tier prompts to improve its products.

**OpenRouter free models (Kimi, Gemma, Qwen, Llama…):**
1. Create a free account at <https://openrouter.ai> and make a key at <https://openrouter.ai/settings/keys>.
2. In Drape: **settings → AI → OpenRouter free models** → paste the key → **use this**.
3. Tap **find free models**. Drape picks a free model that can read photos and a free chat
   model (Kimi when it's free). Free use is capped at roughly 50 requests a day.

**Run a model on your own computer (free, fully private):** install [Ollama](https://ollama.com),
pull a vision model (e.g. `ollama pull gemma3`), start it with `OLLAMA_ORIGINS=* ollama serve`, then
choose **Other (OpenAI-compatible)** in settings with address `http://localhost:11434/v1`.

**Claude (paid, best):** paste a key from <https://console.anthropic.com/settings/keys>. Claude can
search shops by itself to find the clean product photo of something you photographed.

## Put it online with GitHub Pages (free)

1. Create a new repository on GitHub (e.g. `drape`). Public repos get Pages for free.
2. Push this folder to it:
   ```bash
   git remote add origin https://github.com/<you>/drape.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The included workflow (`.github/workflows/deploy.yml`) builds and publishes on every push.
   Your app will be at `https://<you>.github.io/drape/`.

On your phone, open that address and use **Add to Home Screen**. It then opens like an app and
works offline.

## Your data

- Everything is stored in your browser (IndexedDB) on that device. Phone and laptop are separate.
  Use **settings → export backup / import backup** to move or back up your wardrobe.
- API keys are stored only in your browser and sent only to the provider you choose.
- Shop links are read through the free [Jina Reader](https://jina.ai/reader). Shop photos that
  block downloads are fetched through the free [images.weserv.nl](https://images.weserv.nl) relay.
- If a shop blocks the free reader, deploy the tiny optional helper in `worker/link-helper.js` to
  Cloudflare Workers (free) and paste its URL into settings.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
```

Stack: React + TypeScript + Vite, `idb` for storage, Open-Meteo for weather (free, no key),
`@imgly/background-removal` for on-device cut-outs (loaded from a CDN on first use; AGPL-3.0, which
is fine for this open-source personal app), `@anthropic-ai/sdk` for Claude (loaded only when used).

```
src/
  lib/rules.ts      outfit engine (no AI)
  lib/colors.ts     colour naming, harmony and extraction
  lib/ai.ts         AI providers: Gemini, OpenRouter, OpenAI-compatible, Claude
  lib/web.ts        free page reader + search links
  lib/pipeline.ts   photo/link → wardrobe item
  lib/db.ts         storage, backup
  pages/            today, closet, item, add, looks, builder, plan, stylist, insights, settings
```
