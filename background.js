/* FBM Finder — background service worker.
 * Orchestrates background-tab scraping of Facebook Marketplace and scores deals.
 */

let cancelled = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_SEARCH") {
    cancelled = false;
    handleSearch(msg.payload)
      .then((deals) => sendResponse({ deals }))
      .catch((err) => sendResponse({ error: err && err.message ? err.message : String(err) }));
    return true; // keep the message channel open for async response
  }
  if (msg.type === "ESTIMATE_SELL") {
    cancelled = false;
    handleEstimate(msg.payload)
      .then((estimate) => sendResponse({ estimate }))
      .catch((err) => sendResponse({ error: err && err.message ? err.message : String(err) }));
    return true;
  }
  if (msg.type === "CANCEL_SEARCH") {
    cancelled = true;
    sendResponse({ ok: true });
  }
});

function progress(text) {
  chrome.runtime.sendMessage({ type: "SEARCH_PROGRESS", text }).catch(() => {});
}

async function handleSearch({ keywords, maxPrice, radiusMiles, dealStrength }) {
  const allListings = [];

  for (let i = 0; i < keywords.length; i++) {
    if (cancelled) throw new Error("Search cancelled.");
    const keyword = keywords[i];
    progress(`Scanning "${keyword}" (${i + 1}/${keywords.length})…`);

    const listings = await scrapeKeyword(keyword, maxPrice);
    // Tag each listing with the keyword it matched and score it within its group.
    const scored = scoreGroup(listings, dealStrength);
    scored.forEach((l) => (l.keyword = keyword));
    allListings.push(...scored);
  }

  if (cancelled) throw new Error("Search cancelled.");
  progress("Ranking deals…");

  let deals = allListings;

  // Distance filter (only when a numeric distance was parsed from the listing).
  deals = deals.filter((l) => l.distanceMiles == null || l.distanceMiles <= radiusMiles);

  // Max price filter (belt-and-suspenders; FBM URL filter may not always apply).
  if (maxPrice != null) {
    deals = deals.filter((l) => l.price == null || l.price <= maxPrice);
  }

  // Keep only items that meet the requested deal strength.
  deals = deals.filter((l) => l.dealScore >= dealStrength - 1e-9);

  // De-duplicate by item id, keeping the best deal.
  const byId = new Map();
  for (const d of deals) {
    const existing = byId.get(d.id);
    if (!existing || d.dealScore > existing.dealScore) byId.set(d.id, d);
  }
  deals = [...byId.values()];

  // Best deals first; tie-break on lower price.
  deals.sort((a, b) => b.dealScore - a.dealScore || (a.price ?? Infinity) - (b.price ?? Infinity));

  return deals.slice(0, 10);
}

/* ---- Sell Estimator ----
 * Estimates the chance of selling at various price points by comparing a candidate
 * price to the live market of comparable listings. The model: an item is more likely
 * to sell the more listings it undercuts. chance(price) = share of comparable listings
 * priced strictly above `price`, clamped to a sensible range.
 */
async function handleEstimate({ keyword, yourPrice }) {
  progress(`Checking the market for "${keyword}"…`);
  const listings = await scrapeKeyword(keyword, null);
  if (cancelled) throw new Error("Search cancelled.");

  const prices = listings
    .map((l) => l.price)
    .filter((p) => typeof p === "number" && p > 0)
    .sort((a, b) => a - b);

  const n = prices.length;
  if (n < 3) return { sampleSize: n };

  const quantile = (q) => {
    const idx = (n - 1) * q;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return prices[lo] + (prices[hi] - prices[lo]) * (idx - lo);
  };

  const sellChance = (price) => {
    const above = prices.filter((p) => p > price).length;
    // Share of the market you undercut, softened away from 0%/100% extremes.
    return Math.max(0.04, Math.min(0.97, above / n));
  };

  const median = Math.round(quantile(0.5));
  const low = Math.round(quantile(0.1));
  const high = Math.round(quantile(0.9));

  // Build an evenly spaced price curve across the bulk of the market (p5–p95).
  const lo = quantile(0.05);
  const hi = quantile(0.95);
  const POINTS = 8;
  const rawStep = (hi - lo) / (POINTS - 1) || 1;
  const step = niceRound(rawStep);
  const start = Math.max(0, Math.round(lo / step) * step);
  const curve = [];
  for (let i = 0; i < POINTS; i++) {
    const price = start + i * step;
    curve.push({ price, chance: sellChance(price) });
  }

  const estimate = {
    keyword,
    sampleSize: n,
    median,
    low,
    high,
    quickSalePrice: Math.round(quantile(0.25)), // ~75% sell chance
    topDollarPrice: Math.round(quantile(0.75)), // ~25% sell chance
    step,
    curve,
    yourPrice: null,
  };

  if (typeof yourPrice === "number" && yourPrice > 0) {
    const chance = sellChance(yourPrice);
    estimate.yourPrice = {
      price: yourPrice,
      chance,
      verdict: verdictFor(chance, yourPrice, median),
    };
  }

  return estimate;
}

function verdictFor(chance, price, median) {
  if (chance >= 0.7) return "Priced to move — likely a fast sale.";
  if (chance >= 0.45) return "Competitively priced — solid chance of selling.";
  if (chance >= 0.25)
    return `A bit high vs. the ~$${median.toLocaleString()} typical price — expect to wait or negotiate.`;
  return `Above most comparable listings — may sit unless you drop toward $${median.toLocaleString()}.`;
}

// Round a step to a friendly increment (1, 2, 5 × 10^n).
function niceRound(x) {
  if (x <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(x)));
  const norm = x / mag;
  let nice;
  if (norm < 1.5) nice = 1;
  else if (norm < 3.5) nice = 2;
  else if (norm < 7.5) nice = 5;
  else nice = 10;
  return Math.max(1, nice * mag);
}

/* Compute a deal score for each listing relative to the median price of its group. */
function scoreGroup(listings, dealStrength) {
  const priced = listings.filter((l) => typeof l.price === "number" && l.price > 0);
  const prices = priced.map((l) => l.price).sort((a, b) => a - b);
  const median =
    prices.length === 0
      ? null
      : prices.length % 2
      ? prices[(prices.length - 1) / 2]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;

  return listings.map((l) => {
    let dealScore = 0;
    if (median && typeof l.price === "number" && l.price > 0) {
      dealScore = (median - l.price) / median; // fraction below median
    }
    return { ...l, median, dealScore };
  });
}

/* Open a background tab on the Marketplace search and scrape rendered listings. */
async function scrapeKeyword(keyword, maxPrice) {
  const url = buildSearchUrl(keyword, maxPrice);
  const tab = await chrome.tabs.create({ url, active: false });

  try {
    await waitForTabComplete(tab.id, 25000);
    if (cancelled) throw new Error("Search cancelled.");

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePageListings,
    });
    return Array.isArray(result) ? result : [];
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      /* tab already gone */
    }
  }
}

function buildSearchUrl(keyword, maxPrice) {
  const params = new URLSearchParams();
  params.set("query", keyword);
  params.set("sortBy", "price_ascend"); // cheapest first → surfaces deals
  if (maxPrice != null) params.set("maxPrice", String(maxPrice));
  return `https://www.facebook.com/marketplace/search/?${params.toString()}`;
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Safety timeout in case "complete" never fires (SPA quirks).
    setTimeout(finish, timeoutMs);
  });
}

/* ---- Injected into the Marketplace page. Must be self-contained. ---- */
function scrapePageListings() {
  // Scroll a few times to trigger lazy loading, then parse the DOM.
  const SCROLLS = 6;
  const SCROLL_DELAY = 700;

  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      window.scrollTo(0, document.body.scrollHeight);
      i++;
      if (i < SCROLLS) {
        setTimeout(tick, SCROLL_DELAY);
      } else {
        setTimeout(() => resolve(parse()), SCROLL_DELAY);
      }
    };
    setTimeout(tick, SCROLL_DELAY);

    function parse() {
      const anchors = Array.from(
        document.querySelectorAll('a[href*="/marketplace/item/"]')
      );
      const seen = new Set();
      const items = [];

      for (const a of anchors) {
        const href = a.href.split("?")[0];
        const idMatch = href.match(/\/marketplace\/item\/(\d+)/);
        const id = idMatch ? idMatch[1] : href;
        if (seen.has(id)) continue;
        seen.add(id);

        const text = (a.innerText || "").trim();
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        // Price: first line containing a currency amount.
        let price = null;
        let priceLine = lines.find((l) => /[$£€]\s?\d/.test(l));
        if (priceLine) {
          const num = priceLine.replace(/[^0-9.]/g, "");
          if (num) price = parseFloat(num);
        }
        // "Free" listings.
        if (price == null && lines.some((l) => /^free$/i.test(l))) price = 0;

        // Title: the longest non-price, non-location-looking line.
        const candidateTitles = lines.filter(
          (l) => l !== priceLine && !/[$£€]\s?\d/.test(l)
        );
        let title = candidateTitles.sort((a, b) => b.length - a.length)[0] || "";

        // Location / distance: a line that mentions a distance or looks like "City, ST".
        let location = "";
        let distance = "";
        let distanceMiles = null;
        for (const l of lines) {
          const milesMatch = l.match(/([\d.]+)\s*(mi|miles|km)\b/i);
          if (milesMatch) {
            distance = l;
            let val = parseFloat(milesMatch[1]);
            if (/km/i.test(milesMatch[2])) val *= 0.621371;
            distanceMiles = val;
          } else if (/,\s?[A-Z]{2}\b/.test(l) && l !== title) {
            location = l;
          }
        }

        // Thumbnail image.
        let image = "";
        const img = a.querySelector("img");
        if (img) image = img.src || img.getAttribute("xlink:href") || "";

        items.push({
          id,
          url: href,
          title,
          price,
          image,
          location,
          distance,
          distanceMiles,
        });
      }
      return items;
    }
  });
}
