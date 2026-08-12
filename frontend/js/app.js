/*
  app.js
  ------
  Shared helpers loaded on every page (index.html, dashboard.html, scheme.html).
  Keeps three small jobs:
    1. A stable, anonymous "client id" so bookmarks can be saved without
       asking for any personal information (see database.py for why).
    2. A tiny wrapper around fetch() that turns network/server failures into
       friendly messages instead of raw errors reaching the user.
    3. A simple toast notification for quick confirmations (e.g. "Bookmarked").
*/

const FarmaSchema = (() => {
  const CLIENT_ID_KEY = "farmaschema_client_id";
  const ADMIN_TOKEN_KEY = "farmaschema_admin_token";

  function getClientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = "farmer-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }

  /**
   * Admin token is kept in sessionStorage (not localStorage) so that
   * closing the tab/browser signs the admin out automatically, and it
   * never lingers across unrelated browser sessions on a shared machine.
   */
  function getAdminToken() {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
  }

  function setAdminToken(token) {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  }

  function clearAdminToken() {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  }

  /**
   * Wrapper around fetch() for talking to our own Flask API.
   * Because app.py serves the frontend AND the API from the same origin,
   * a plain relative path like "/api/schemes" works whether you open
   * the site via Flask, a different port, or a preview tool.
   */
  async function apiRequest(path, options = {}) {
    let response;
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    try {
      response = await fetch(path, {
        ...options,
        headers,
      });
    } catch (networkError) {
      // The backend isn't reachable at all.
      throw new Error(
        "Can't reach the FarmaSchema server. Make sure the Flask backend is running, then reload this page."
      );
    }

    let body = null;
    try {
      body = await response.json();
    } catch (parseError) {
      // Server responded but not with JSON — treat as a generic failure.
    }

    if (!response.ok) {
      const message = (body && body.error) || `Something went wrong (status ${response.status}).`;
      throw new Error(message);
    }

    return body;
  }

  function showToast(message) {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("visible"), 2200);
  }

  function relevanceFillClass(score) {
    if (score >= 0.5) return "strong";
    if (score >= 0.2) return "";
    return "weak";
  }

  function scorePercent(score) {
    // TF-IDF cosine similarity scores on short text rarely reach 1.0, so we
    // scale for display purposes only (never for ranking, which always
    // uses the raw score). This keeps the percentages readable without
    // changing which scheme is ranked above another.
    return Math.min(100, Math.round(score * 220));
  }

  return {
    getClientId,
    apiRequest,
    showToast,
    relevanceFillClass,
    scorePercent,
    getAdminToken,
    setAdminToken,
    clearAdminToken,
  };
})();

/* Shared farmer header controls and the self-contained state/language picker. */
FarmaSchema.mountFarmerControls = function mountFarmerControls() {
  const header = document.querySelector(".site-header");
  if (!header || header.dataset.farmerControls) return;
  header.dataset.farmerControls = "true";
  const nav = header.querySelector(".site-nav");
  // FarmaI18n is a top-level lexical browser binding (not a window property).
  if (!nav || typeof FarmaI18n === "undefined") return;
  const saved = document.createElement("a"); saved.href = "saved.html"; saved.dataset.i18n = "saved"; saved.textContent = FarmaI18n.t("saved");
  const language = document.createElement("button"); language.type = "button"; language.className = "header-language"; language.dataset.languageLabel = "";
  nav.insertBefore(saved, nav.querySelector('a[href="admin.html"]'));
  nav.insertBefore(language, saved);
  const dialog = document.createElement("dialog"); dialog.className = "language-dialog";
  const states = Object.keys(FarmaI18n.stateLanguage);
  dialog.innerHTML = `<form method="dialog" class="language-picker"><button class="dialog-close" aria-label="Close">×</button><h2 data-i18n="chooseLanguage">Choose your language</h2><p data-i18n="chooseLanguageHelp">Choose a language or select your state on the map.</p><label for="language-select" data-i18n="selectLanguage">Select language</label><select id="language-select"></select><h3>India state language map</h3><p class="map-note">A primary/default language is used for each state; you can choose any of the 22 languages from the dropdown.</p><div class="india-state-map" role="group" aria-label="India state language map"></div><button type="button" class="btn btn-secondary map-reset" data-i18n="resetState">Reset state</button></form>`;
  const select = dialog.querySelector("select");
  Object.entries(FarmaI18n.languages).forEach(([code, info]) => { const o=document.createElement("option"); o.value=code; o.textContent=`${info.name} — ${info.native}`; select.appendChild(o); });
  const map = dialog.querySelector(".india-state-map");
  states.forEach(state => { const b=document.createElement("button"); b.type="button"; b.className="map-state"; b.dataset.state=state; b.dataset.language=FarmaI18n.stateLanguage[state]; b.textContent=state; b.title=`${state} → ${FarmaI18n.languages[b.dataset.language].native}`; b.setAttribute("aria-label",b.title); map.appendChild(b); });
  document.body.appendChild(dialog);
  function markState(state) { map.querySelectorAll(".map-state").forEach(b => { const active=b.dataset.state===state; b.classList.toggle("selected",active); b.setAttribute("aria-pressed",String(active)); }); }
  language.addEventListener("click",()=>{ select.value=FarmaI18n.lang(); dialog.showModal(); });
  select.addEventListener("change",()=>{ markState(""); FarmaI18n.setLang(select.value); });
  map.addEventListener("click",e=>{const b=e.target.closest(".map-state");if(!b)return; select.value=b.dataset.language; markState(b.dataset.state); FarmaI18n.setLang(b.dataset.language);});
  dialog.querySelector(".map-reset").addEventListener("click",()=>markState(""));
  FarmaI18n.apply();
};
