/* FBM Finder — popup controller */

const els = {
  form: document.getElementById("form-section"),
  status: document.getElementById("status-section"),
  results: document.getElementById("results-section"),
  keywords: document.getElementById("keywords"),
  maxPrice: document.getElementById("maxPrice"),
  radius: document.getElementById("radius"),
  dealStrength: document.getElementById("dealStrength"),
  dealValue: document.getElementById("dealValue"),
  findBtn: document.getElementById("findBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  newSearchBtn: document.getElementById("newSearchBtn"),
  statusText: document.getElementById("statusText"),
  resultsList: document.getElementById("results-list"),
  resultsTitle: document.getElementById("resultsTitle"),
  emptyState: document.getElementById("emptyState"),
};

// Restore last-used inputs.
chrome.storage.local.get(["lastInputs"], ({ lastInputs }) => {
  if (!lastInputs) return;
  els.keywords.value = lastInputs.keywords || "";
  if (lastInputs.maxPrice != null) els.maxPrice.value = lastInputs.maxPrice;
  if (lastInputs.radius != null) els.radius.value = lastInputs.radius;
  if (lastInputs.dealStrength != null) {
    els.dealStrength.value = lastInputs.dealStrength;
    els.dealValue.textContent = lastInputs.dealStrength + "%";
  }
});

els.dealStrength.addEventListener("input", () => {
  els.dealValue.textContent = els.dealStrength.value + "%";
});

function showSection(name) {
  els.form.classList.toggle("hidden", name !== "form");
  els.status.classList.toggle("hidden", name !== "status");
  els.results.classList.toggle("hidden", name !== "results");
}

els.findBtn.addEventListener("click", runSearch);
els.cancelBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CANCEL_SEARCH" });
  showSection("form");
});
els.newSearchBtn.addEventListener("click", () => showSection("form"));

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
    (response) => {
      if (chrome.runtime.lastError) {
        renderError(chrome.runtime.lastError.message);
        return;
      }
      if (!response) {
        renderError("No response from background worker.");
        return;
      }
      if (response.error) {
        renderError(response.error);
        return;
      }
      renderResults(response.deals || []);
    }
  );
}

// Progress updates from the background worker.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SEARCH_PROGRESS") {
    els.statusText.textContent = msg.text;
  }
});

function renderError(message) {
  showSection("results");
  els.resultsTitle.textContent = "Something went wrong";
  els.resultsList.innerHTML = "";
  els.emptyState.classList.remove("hidden");
  els.emptyState.innerHTML =
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
      dealPct > 0
        ? `<span class="deal-badge">${dealPct}% under typical</span>`
        : "";
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
      </div>
    `;
    els.resultsList.appendChild(li);
  });
}

function formatPrice(price) {
  if (price == null || isNaN(price)) return "Price N/A";
  return "$" + Number(price).toLocaleString();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
