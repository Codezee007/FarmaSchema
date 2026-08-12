/*
  scheme.js
  ---------
  Powers scheme.html in two modes, decided purely by the URL:
    - scheme.html            -> "browse" mode: grid of every scheme (Scheme Status Page)
    - scheme.html?id=pm-kisan -> "detail" mode: full details for one scheme

  In detail mode, if the farmer got here by clicking "View details" from the
  dashboard, we also show their personal relevance score and matched/missing
  attributes for that scheme, read from the last recommendation saved in
  localStorage by dashboard.js.
*/

(function () {
  const params = new URLSearchParams(window.location.search);
  const schemeId = params.get("id");

  if (schemeId) {
    showDetailView(schemeId);
  } else {
    showBrowseView();
  }
  window.addEventListener("farmaschema:languagechange", () => window.location.reload());

  // ---------------------------------------------------------------------
  // Browse mode
  // ---------------------------------------------------------------------

  async function showBrowseView() {
    const loading = document.getElementById("browse-loading");
    const grid = document.getElementById("browse-grid");

    try {
      const data = await FarmaSchema.apiRequest("/api/schemes");
      const schemes = data.schemes || [];

      grid.innerHTML = schemes.map((original) => { const s = FarmaI18n.localizeScheme(original); return `
        <article class="card">
          <h3 style="font-size:17px;">${escapeHtml(s.name)}</h3>
          <p style="color:var(--color-text-muted); font-size:14.5px;">${escapeHtml(s.short_description)}</p>
          <div style="display:flex; gap:10px; margin-top:10px;">
            <a class="btn btn-primary" href="scheme.html?id=${encodeURIComponent(s.id)}">${FarmaI18n.t("view")}</a>
            <a class="btn btn-ghost" href="${escapeAttr(s.official_url)}" target="_blank" rel="noopener">${FarmaI18n.lang() === "kn" ? "ಅಧಿಕೃತ ಜಾಲತಾಣ ↗" : "Official site ↗"}</a>
          </div>
        </article>`; }).join("");

      loading.style.display = "none";
      grid.style.display = "grid";
    } catch (err) {
      loading.innerHTML = `
        <div class="state-box card">
          <div class="icon">⚠️</div>
          <p>${escapeHtml(err.message)}</p>
        </div>`;
    }
  }

  // ---------------------------------------------------------------------
  // Detail mode
  // ---------------------------------------------------------------------

  async function showDetailView(id) {
    document.getElementById("browse-view").style.display = "none";
    document.getElementById("detail-view").style.display = "block";

    const loadingEl = document.getElementById("detail-loading");
    const contentEl = document.getElementById("detail-content");
    const errorEl = document.getElementById("detail-error");

    try {
      const scheme = await FarmaSchema.apiRequest(`/api/schemes/${encodeURIComponent(id)}`);
      renderDetail(scheme);
      await setupBookmarkButton(scheme);

      loadingEl.style.display = "none";
      contentEl.style.display = "block";
    } catch (err) {
      loadingEl.style.display = "none";
      document.getElementById("detail-error-message").textContent = err.message;
      errorEl.style.display = "block";
    }
  }

  function renderDetail(scheme) {
    scheme = FarmaI18n.localizeScheme(scheme);
    document.title = `${scheme.name} — FarmaSchema`;
    document.getElementById("detail-name").textContent = scheme.name;
    document.getElementById("detail-short").textContent = scheme.short_description;
    document.getElementById("detail-description").textContent = scheme.description;
    document.getElementById("detail-benefits").textContent = scheme.benefits;
    document.getElementById("detail-application").textContent = scheme.application_process;

    const eligibilityList = document.getElementById("detail-eligibility");
    eligibilityList.innerHTML = (scheme.eligibility || []).map((e) => `<li>${escapeHtml(e)}</li>`).join("");

    const officialLink = document.getElementById("detail-official-link");
    officialLink.href = scheme.official_url || "#";

    document.getElementById("detail-verify-note").textContent = scheme.verify_note || "";

    renderPersonalRelevance(scheme.id);
  }

  function renderPersonalRelevance(schemeId) {
    const saved = localStorage.getItem("farmaschema_last_recommend");
    if (!saved) return;

    let data;
    try {
      data = JSON.parse(saved);
    } catch (e) {
      return;
    }

    const match = (data.recommendations || []).find((r) => r.id === schemeId);
    if (!match) return;

    const sidebar = document.getElementById("relevance-sidebar");
    const percent = FarmaSchema.scorePercent(match.relevance_score);
    const fillClass = FarmaSchema.relevanceFillClass(match.relevance_score);

    document.getElementById("detail-relevance-value").textContent = `${percent}%`;
    const fillEl = document.getElementById("detail-relevance-fill");
    fillEl.style.width = `${percent}%`;
  if (fillClass) {
  fillEl.classList.add(fillClass);
}

    document.getElementById("detail-matched").innerHTML =
      match.matched_attributes.map((m) => `<li><span class="ok">✓</span><span>${escapeHtml(m)}</span></li>`).join("");
    document.getElementById("detail-unknown").innerHTML =
      match.unknown_or_missing.map((m) => `<li><span class="warn">⚠</span><span>${escapeHtml(m)}</span></li>`).join("");

    sidebar.style.display = "block";
  }

  async function setupBookmarkButton(scheme) {
    const btn = document.getElementById("detail-bookmark-btn");
    const clientId = FarmaSchema.getClientId();
    let isActive = false;

    try {
      const data = await FarmaSchema.apiRequest(`/api/bookmarks?client_id=${encodeURIComponent(clientId)}`);
      isActive = (data.bookmarks || []).some((b) => b.scheme_id === scheme.id);
    } catch (e) {
      // Non-critical.
    }

    updateBookmarkBtn(btn, isActive);

    btn.addEventListener("click", async () => {
      const nextActive = btn.dataset.active !== "true";
      btn.disabled = true;
      try {
        await FarmaSchema.apiRequest("/api/bookmark", {
          method: "POST",
          body: JSON.stringify({
            client_id: clientId,
            scheme_id: scheme.id,
            action: nextActive ? "add" : "remove",
          }),
        });
        updateBookmarkBtn(btn, nextActive);
        FarmaSchema.showToast(nextActive ? "Saved to your bookmarks" : "Removed from bookmarks");
      } catch (err) {
        FarmaSchema.showToast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function updateBookmarkBtn(btn, isActive) {
    btn.dataset.active = String(isActive);
    btn.textContent = isActive ? "★ Saved" : "☆ Save this scheme";
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str == null ? "" : str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }
})();
