# FBM Finder — Facebook Marketplace Deal Finder

A Chrome extension that finds the best **Facebook Marketplace (FBM)** deals near you.
Type in the products you want, set how good a deal you want, and it scans Marketplace
and returns the **top 10 deals** — each with a direct link to the listing.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-1877f2)

---

## What it does

1. You enter one or more product keywords (e.g. `iphone 13, mountain bike, dyson`).
2. Optionally set a **max price** and **max distance (miles)**.
3. Set a **deal strength** — how far *below the typical price* an item must be to count
   as a deal (e.g. 15% under the median of comparable listings).
4. The extension opens Marketplace searches in background tabs, reads the listings,
   scores them, and shows the **top 10**, sorted by how good the deal is.
5. Each result has a **“See on Facebook Marketplace →”** link straight to the item.

## How the “deal” score works

There's no public Facebook price database, so FBM Finder is self-contained: for each
keyword it gathers the comparable listings, computes their **median price**, and scores
every item by how far below that median it sits. An item priced 30% under the median of
similar listings scores as a 30% deal. You choose the minimum threshold with the slider.

---

## Installing (Load Unpacked)

This isn't on the Chrome Web Store yet — load it manually:

1. Download / clone this repo.
2. Open `chrome://extensions` in Chrome (or any Chromium browser: Edge, Brave, etc.).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this project folder.
5. Pin the **FBM Finder** icon to your toolbar.

## Using it

1. **Log into Facebook** in the same browser. The extension reads listings from your
   own logged-in session — it is **not** a server-side bot.
2. Make sure your **Marketplace location** is set to the area you want
   (Marketplace → Filters → Location). Distance is based on this.
3. Click the FBM Finder icon, fill in the form, and hit **Find Deals**.
4. Background tabs open briefly while it scans, then the top 10 appear in the popup.

---

## Honest limitations

- **Requires your logged-in Facebook session.** Facebook blocks anonymous/server
  scraping, so this works only in a browser where you're signed in.
- **Facebook changes its HTML often.** The scraper uses resilient heuristics (it keys
  off `/marketplace/item/` links and parses prices/titles/distance from the card text),
  but a big Facebook redesign may require updating `scrapePageListings()` in
  `background.js`.
- **Radius is approximate.** Facebook doesn't reliably accept a radius via URL, so the
  extension uses your Marketplace location and then filters out items whose shown
  distance exceeds your limit. Listings that don't display a distance are kept.
- **“Typical price” is relative to results**, not a global market value. Narrow,
  specific keywords (`iphone 13 128gb`) give better deal scoring than broad ones
  (`phone`).
- Respect [Facebook's Terms of Service](https://www.facebook.com/legal/terms). This is
  for personal, manual deal-hunting in your own session.

---

## Project structure

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest, permissions, popup + service worker registration |
| `popup.html` / `popup.css` / `popup.js` | The search form and results UI |
| `background.js` | Orchestrates background-tab scraping, scoring, ranking; contains the injected `scrapePageListings` scraper |
| `icons/` | Toolbar icons |

## Tweaking

- **Scan depth:** in `background.js`, raise `SCROLLS` in `scrapePageListings` to load
  more listings per keyword (slower, more thorough).
- **Sort/price URL:** `buildSearchUrl` sorts cheapest-first and passes `maxPrice`.
- **Result count:** change `deals.slice(0, 10)` in `handleSearch`.

## License

MIT
