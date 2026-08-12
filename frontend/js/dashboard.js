/*
  dashboard.js
  ------------
  Handles the farmer profile form on dashboard.html:
    1. Validates the form (friendly inline messages, no raw errors).
    2. Sends the profile to POST /api/recommend.
    3. Renders the ranked, explained results.
    4. Lets the farmer bookmark schemes and jump to scheme.html for details.

  The last successful recommend() response is also saved to localStorage so
  that scheme.html can show "your relevance score" when you click through
  to a specific scheme's detail page.
*/

(function () {
  const form = document.getElementById("profile-form");
  const submitBtn = document.getElementById("submit-btn");
  const formStatus = document.getElementById("form-status");

  const resultsSection = document.getElementById("results-section");
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const errorMessage = document.getElementById("error-message");
  const retryBtn = document.getElementById("retry-btn");

  const profileSummary = document.getElementById("profile-summary");
  const resultsContainer = document.getElementById("results-container");
  const resultsCount = document.getElementById("results-count");

  let lastProfile = null;
  let bookmarkedIds = new Set();

  function clearFieldErrors() {
    document.querySelectorAll(".form-field.has-error").forEach((el) => el.classList.remove("has-error"));
  }

  function markFieldError(fieldName) {
    const field = form.querySelector(`[data-field="${fieldName}"]`);
    if (field) field.classList.add("has-error");
  }

  function readProfileFromForm() {
    const formData = new FormData(form);
    const landCategory = (formData.get("land_category") || "").split("|");

    return {
      state: (formData.get("state") || "").trim(),
      district: (formData.get("district") || "").trim(),
      crop: (formData.get("crop") || "").trim(),
      // The one land-holding dropdown keeps the existing API shape. Its
      // representative acres value is used only for the current range check.
      land_size: landCategory[1] ? Number(landCategory[1]) : null,
      category: (landCategory[0] || "").trim(),
      irrigation: formData.get("irrigation") || "",
      details: (formData.get("details") || "").trim(),
    };
  }

  function validate(profile) {
    clearFieldErrors();
    const errors = [];

    if (!profile.state) { errors.push("state"); markFieldError("state"); }
    if (!profile.crop) { errors.push("crop"); markFieldError("crop"); }
    if (!profile.category) { errors.push("land_category"); markFieldError("land_category"); }
    if (!profile.irrigation) { errors.push("irrigation"); markFieldError("irrigation"); }

    if (profile.land_size === null || Number.isNaN(profile.land_size) || profile.land_size < 0) {
      errors.push("land_category");
      markFieldError("land_category");
    }

    return errors;
  }

  function renderProfileSummary(profile) {
    const chips = [
      profile.state,
      profile.district,
      profile.crop,
      profile.category,
      profile.irrigation === "Yes" ? "Irrigated" : "Not irrigated",
    ].filter(Boolean);

    profileSummary.innerHTML = chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  function attrListHtml(matched, unknown) {
    const matchedHtml = matched.map((m) => `<li><span class="ok">✓</span><span>${escapeHtml(m)}</span></li>`).join("");
    const unknownHtml = unknown.map((m) => `<li><span class="warn">⚠</span><span>${escapeHtml(m)}</span></li>`).join("");
    return matchedHtml + unknownHtml;
  }

  function renderResults(recommendations) {
    resultsCount.textContent = FarmaI18n.lang() === "kn"
      ? `${recommendations.length} ಯೋಜನೆಗಳು, ಹೊಂದಾಣಿಕೆಯ ಆಧಾರದಲ್ಲಿ ಶ್ರೇಯಾಂಕಿಸಲಾಗಿದೆ`
      : `${recommendations.length} schemes, ranked by relevance`;

    if (recommendations.length === 0) {
      resultsContainer.innerHTML = `
        <div class="state-box card">
          <div class="icon">🔍</div>
          <p>No schemes could be matched to this profile. Try adjusting your details.</p>
        </div>`;
      return;
    }

    resultsContainer.innerHTML = recommendations.map((originalRec) => {
      const rec = FarmaI18n.localizeScheme(originalRec);
      const percent = FarmaSchema.scorePercent(rec.relevance_score);
      const fillClass = FarmaSchema.relevanceFillClass(rec.relevance_score);
      const isBookmarked = bookmarkedIds.has(rec.id);

      return `
        <article class="scheme-card" data-scheme-id="${rec.id}">
          <div class="scheme-card-top">
            <div style="flex:1; min-width:220px;">
              <h3>${escapeHtml(rec.name)}</h3>
              <p class="short-desc">${escapeHtml(rec.short_description)}</p>
            </div>
            <button class="bookmark-btn" data-active="${isBookmarked}" title="Save this scheme" aria-label="Bookmark ${escapeHtml(rec.name)}">
              ${isBookmarked ? "★" : "☆"}
            </button>
            <div class="relevance-block">
              <div class="relevance-label">${FarmaI18n.t("relevance")}</div>
              <div class="relevance-value">${percent}%</div>
              <div class="relevance-bar"><div class="relevance-fill ${fillClass}" style="width:${percent}%"></div></div>
            </div>
          </div>

          <details class="why-box">
            <summary>${FarmaI18n.t("why")}</summary>
            <ul class="attr-list">${attrListHtml(rec.matched_attributes, rec.unknown_or_missing)}</ul>
          </details>

          <div class="scheme-card-actions">
            <a class="btn btn-primary" href="scheme.html?id=${encodeURIComponent(rec.id)}">${FarmaI18n.t("view")}</a>
          </div>
        </article>`;
    }).join("");

    // Wire up bookmark buttons after rendering.
    resultsContainer.querySelectorAll(".bookmark-btn").forEach((btn) => {
      btn.addEventListener("click", () => toggleBookmark(btn));
    });
  }

  async function toggleBookmark(btn) {
    const card = btn.closest(".scheme-card");
    const schemeId = card.dataset.schemeId;
    const schemeName = card.querySelector("h3").textContent;
    const isActive = btn.dataset.active === "true";
    const action = isActive ? "remove" : "add";

    btn.disabled = true;
    try {
      await FarmaSchema.apiRequest("/api/bookmark", {
        method: "POST",
        body: JSON.stringify({ client_id: FarmaSchema.getClientId(), scheme_id: schemeId, action }),
      });
      if (action === "add") {
        bookmarkedIds.add(schemeId);
        btn.dataset.active = "true";
        btn.textContent = "★";
        FarmaSchema.showToast(`Saved ${schemeName}`);
      } else {
        bookmarkedIds.delete(schemeId);
        btn.dataset.active = "false";
        btn.textContent = "☆";
        FarmaSchema.showToast(`Removed ${schemeName}`);
      }
    } catch (err) {
      FarmaSchema.showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function loadExistingBookmarks() {
    try {
      const data = await FarmaSchema.apiRequest(`/api/bookmarks?client_id=${encodeURIComponent(FarmaSchema.getClientId())}`);
      bookmarkedIds = new Set((data.bookmarks || []).map((b) => b.scheme_id));
    } catch (err) {
      // Non-critical — bookmarks just won't pre-fill as saved.
      bookmarkedIds = new Set();
    }
  }

  async function runRecommendation(profile) {
    resultsSection.style.display = "none";
    errorState.style.display = "none";
    loadingState.style.display = "block";

    try {
      await loadExistingBookmarks();
      const data = await FarmaSchema.apiRequest("/api/recommend", {
        method: "POST",
        body: JSON.stringify(profile),
      });

      localStorage.setItem("farmaschema_last_recommend", JSON.stringify(data));

      renderProfileSummary(data.profile);
      renderResults(data.recommendations);

      loadingState.style.display = "none";
      resultsSection.style.display = "block";
      resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      loadingState.style.display = "none";
      errorMessage.textContent = err.message;
      errorState.style.display = "block";
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const profile = readProfileFromForm();
    const errors = validate(profile);

    if (errors.length > 0) {
      formStatus.textContent = "Please fix the highlighted fields.";
      return;
    }

    formStatus.textContent = "";
    lastProfile = profile;
    runRecommendation(profile);
  });

  retryBtn.addEventListener("click", () => {
    if (lastProfile) runRecommendation(lastProfile);
  });

  // If the farmer already ran a search earlier in this browser session,
  // restore it so results aren't lost on an accidental refresh.
  (function restorePreviousSearch() {
    const saved = localStorage.getItem("farmaschema_last_recommend");
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      if (data && data.profile && data.recommendations) {
        lastProfile = data.profile;
        loadExistingBookmarks().then(() => {
          renderProfileSummary(data.profile);
          renderResults(data.recommendations);
          resultsSection.style.display = "block";
        });
      }
    } catch (e) {
      // Ignore malformed saved data.
    }
  })();
  window.addEventListener("farmaschema:languagechange", () => {
    const saved = localStorage.getItem("farmaschema_last_recommend");
    if (!saved) return;
    try { renderResults(JSON.parse(saved).recommendations || []); } catch (e) { /* malformed cache */ }
  });
})();
