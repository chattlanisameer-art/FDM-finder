/* FBM Finder — popup controller */

const els = {
  // panels
  form: document.getElementById("form-section"),
  sell: document.getElementById("sell-section"),
  status: document.getElementById("status-section"),
  results: document.getElementById("results-section"),
  sellResults: document.getElementById("sell-results-section"),
  // tabs
  tabFind: document.getElementById("tab-find"),
  tabSell: document.getElementById("tab-sell"),
  // find inputs
  keywords: document.getElementById("keywords"),
  maxPrice: document.getElementById("maxPrice"),
  radius: document.getElementById("radius"),
  dealStrength: document.getElementById("dealStrength"),
  dealValue: document.getElementById("dealValue"),
  findBtn: document.getElementById("findBtn"),
  // sell inputs
  sellKeyword: document.getElementById("sellKeyword"),
  sellPrice: document.getElementById("sellPrice"),
  estimateBtn: document.getElementById("estimateBtn"),
  // shared
  cancelBtn: document.getElementById("cancelBtn"),
  newSearchBtn: document.getElementById("newSearchBtn"),
  newSellBtn: document.getElementById("newSellBtn"),
  statusText: document.getElementById("statusText"),
  resultsList: document.getElementById("results-list"),
  resultsTitle: document.getElementById("resultsTitle"),
  emptyState: document.getElementById("emptyState"),
  sellSummary: document.getElementById("sell-summary"),
  sellCurve: document.getElementById("sell-curve"),
  sellResultsTitle: document.getElementById("sellResultsTitle"),
  sellEmptyState: document.getElementById("sellEmptyState"),
};

let activeTab = "find";

// Restore last-used inputs.
chrome.storage.local.get(["lastInputs", "lastSell"], ({ lastInputs, lastSell }) => {
  if (lastInputs) {
    els.keywords.value = lastInputs.keywords || "";
    if (lastInputs.maxPrice != null) els.maxPrice.value = lastInputs.maxPrice;
    if (lastInputs.radius != null) els.radius.value = lastInputs.radius;
    if (lastInputs.dealStrength != null) {
      els.dealStrength.value = lastInputs.dealStrength;
      els.dealValue.textContent = lastInputs.dealStrength + "%";
    }
  }
  if (lastSell) {
    els.sellKeyword.value = lastSell.keyword || "";
    if (lastSell.price != null) els.sellPrice.value = lastSell.price;
  }
});

els.dealStrength.addEventListener("input", () => {
  els.dealValue.textContent = els.dealStrength.value + "%";
});

// Tab switching.
els.tabFind.addEventListener("click", () => switchTab("find"));
els.tabSell.addEventListener("click", () => switchTab("sell"));

function switchTab(tab) {
  activeTab = tab;
  els.tabFind.classList.toggle("active", tab === "find");
  els.tabSell.classList.toggle("active", tab === "sell");
  showSection(tab === "find" ? "form" : "sell");
}

function showSection(name) {
  els.form.classList.toggle("hidden", name !== "form");
  els.sell.classList.toggle("hidden", name !== "sell");
  els.status.classList.toggle("hidden", name !== "status");
  els.results.classList.toggle("hidden", name !== "results");
  els.sellResults.classList.toggle("hidden", name !== "sellResults");
}

els.findBtn.addEventListener("click", runSearch);
els.estimateBtn.addEventListener("click", runEstimate);
els.cancelBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CANCEL_SEARCH" });
  showSection(activeTab === "find" ? "form" : "sell");
});
els.newSearchBtn.addEventListener("click", () => showSection("form"));
els.newSellBtn.addEventListener("click", () => showSection("sell"));

/* ---------------- Find Deals ---------------- */

function runSearch() {
  const keywords = els.keywords.value
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (keywords.length === 0) {
    els.keywords.focus();
    els.keywords.style.borderColor = "#e02020";
    return;
  }
  els.keywords.style.borderColor = "";

  const inputs = {
    keywords: els.keywords.value,
    maxPrice: els.maxPrice.value ? Number(els.maxPrice.value) : null,
    radius: Number(els.radius.value) || 25,
    dealStrength: Number(els.dealStrength.value),
  };
  chrome.storage.local.set({ lastInputs: inputs });

  showSection("status");
  els.statusText.textContent = "Opening Facebook Marketplace…";

  chrome.runtime.sendMessage(
    {
      type: "START_SEARCH",
      payload: {
        keywords,
        maxPrice: inputs.maxPrice,
        radiusMiles: inputs.radius,
        dealStrength: inputs.dealStrength / 100,
      },
    },
    (response) => handleResponse(response, () => renderResults(response.deals || []))
  );
}

/* ---------------- Sell Estimator ---------------- */

function runEstimate() {
  const keyword = els.sellKeyword.value.trim();
  if (!keyword) {
    els.sellKeyword.focus();
    els.sellKeyword.style.borderColor = "#e02020";
    return;
  }
  els.sellKeyword.style.borderColor = "";

  const yourPrice = els.sellPrice.value ? Number(els.sellPrice.value) : null;
  chrome.storage.local.set({ lastSell: { keyword, price: yourPrice } });

  showSection("status");
  els.statusText.textContent = "Checking the market…";

  chrome.runtime.sendMessage(
    { type: "ESTIMATE_SELL", payload: { keyword, yourPrice } },
    (response) => handleResponse(response, () => renderSellEstimate(response.estimate))
  );
}

function handleResponse(response, onSuccess) {
  if (chrome.runtime.lastError) return renderError(chrome.runtime.lastError.message);
  if (!response) return renderError("No response from background worker.");
  if (response.error) return renderError(response.error);
  onSuccess();
}

// Progress updates from the background worker.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SEARCH_PROGRESS") els.statusText.textContent = msg.text;
});

function renderError(message) {
  const onSell = activeTab === "sell";
  showSection(onSell ? "sellResults" : "results");
  const title = onSell ? els.sellResultsTitle : els.resultsTitle;
  const empty = onSell ? els.sellEmptyState : els.emptyState;
  if (!onSell) els.resultsList.innerHTML = "";
  else {
    els.sellSummary.innerHTML = "";
    els.sellCurve.innerHTML = "";
  }
  title.textContent = "Something went wrong";
  empty.classList.remove("hidden");
  empty.innerHTML =
    escapeHtml(message) +
    "<br><br>Make sure you're <strong>logged into Facebook</strong> in this browser, then try again.";
}

function renderResults(deals) {
  showSection("results");
  els.resultsList.innerHTML = "";

  if (!deals.length) {
    els.resultsTitle.textContent = "No strong deals found";
    els.emptyState.classList.remove("hidden");
    els.emptyState.innerHTML =
      "No listings met your deal threshold.<br>Try lowering the deal strength, widening distance, or removing the max price.";
    return;
  }

  els.emptyState.classList.add("hidden");
  els.resultsTitle.textContent = `Top ${deals.length} deal${deals.length > 1 ? "s" : ""}`;

  deals.forEach((d) => {
    const li = document.createElement("li");
    li.className = "result-card";
    const dealPct = Math.round(d.dealScore * 100);
    const dealBadge =
      dealPct > 0 ? `<span class="deal-badge">${dealPct}% under typical</span>` : "";
    const distance = d.distance ? `${escapeHtml(d.distance)} · ` : "";
    const location = d.location ? escapeHtml(d.location) : "";

    li.innerHTML = `
      <img class="result-thumb" src="${escapeAttr(d.image || "")}" alt="" onerror="this.style.visibility='hidden'"/>
      <div class="result-body">
        <p class="result-title">${escapeHtml(d.title || "Untitled listing")}</p>
        <div class="result-price">${escapeHtml(formatPrice(d.price))}${dealBadge}</div>
        <div class="result-meta">${distance}${location}</div>
        <div class="result-meta">Matched: ${escapeHtml(d.keyword || "")}</div>
        <a class="result-link" href="${escapeAttr(d.url)}" target="_blank" rel="noopener">See on Facebook Marketplace →</a>
      </div>`;
    els.resultsList.appendChild(li);
  });
}

function renderSellEstimate(est) {
  showSection("sellResults");
  els.sellSummary.innerHTML = "";
  els.sellCurve.innerHTML = "";
  els.sellEmptyState.classList.add("hidden");

  if (!est || est.sampleSize < 3) {
    els.sellResultsTitle.textContent = "Not enough data";
    els.sellEmptyState.classList.remove("hidden");
    els.sellEmptyState.innerHTML =
      `Only found ${est ? est.sampleSize : 0} comparable listing(s).<br>` +
      "Try a broader or different keyword so there's a market to compare against.";
    return;
  }

  els.sellResultsTitle.textContent = `Sell estimate — ${est.sampleSize} comparables`;

  // Summary stats.
  els.sellSummary.innerHTML = `
    <div class="sell-stat-grid">
      <div class="sell-stat"><div class="label">Typical price</div><div class="value">${formatPrice(est.median)}</div></div>
      <div class="sell-stat"><div class="label">Market range</div><div class="value">${formatPrice(est.low)} – ${formatPrice(est.high)}</div></div>
      <div class="sell-stat"><div class="label">Quick-sale price</div><div class="value">${formatPrice(est.quickSalePrice)}</div></div>
      <div class="sell-stat"><div class="label">Top-dollar price</div><div class="value">${formatPrice(est.topDollarPrice)}</div></div>
    </div>`;

  if (est.yourPrice) {
    const pct = Math.round(est.yourPrice.chance * 100);
    els.sellSummary.innerHTML += `
      <div class="your-price-callout">
        At your price of <strong>${formatPrice(est.yourPrice.price)}</strong>, estimated
        chance of selling: <strong>${pct}%</strong><br>
        <span style="color:var(--muted)">${escapeHtml(est.yourPrice.verdict)}</span>
      </div>`;
  }

  // Price → chance curve.
  let curveHtml = '<div class="curve-title">Chance of selling by price</div>';
  est.curve.forEach((pt) => {
    const pct = Math.round(pt.chance * 100);
    const isYours =
      est.yourPrice && Math.abs(pt.price - est.yourPrice.price) <= est.step / 2;
    curveHtml += `
      <div class="curve-row ${isYours ? "highlight" : ""}">
        <div class="curve-price">${formatPrice(pt.price)}</div>
        <div class="curve-bar-wrap">
          <div class="curve-bar" style="width:${pct}%;background:${chanceColor(pt.chance)}"></div>
        </div>
        <div class="curve-pct">${pct}%</div>
      </div>`;
  });
  els.sellCurve.innerHTML = curveHtml;
}

function chanceColor(c) {
  if (c >= 0.66) return "#2e7d32"; // green
  if (c >= 0.33) return "#f5a623"; // amber
  return "#e02020"; // red
}

function formatPrice(price) {
  if (price == null || isNaN(price)) return "Price N/A";
  return "$" + Number(price).toLocaleString();
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
