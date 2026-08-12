/*
  admin.js
  --------
  Powers admin.html. Assumes the admin already logged in via login.html
  (see js/login.js) — if there's no token in sessionStorage, we bounce
  straight back to the login page instead of asking for a token here.
*/
(function () {
  // --- Login gate: this page requires an admin token from login.html ---
  if (!FarmaSchema.getAdminToken()) {
    window.location.href = "login.html";
    return;
  }

  const countEl = document.getElementById("admin-count");
  const statusEl = document.getElementById("admin-status");
  const logoutBtn = document.getElementById("logout-btn");

  const simpleForm = document.getElementById("simple-scheme-form");
  const nameInput = document.getElementById("scheme-name");
  const descriptionInput = document.getElementById("scheme-description");
  const urlInput = document.getElementById("scheme-url");
  const saveSimpleBtn = document.getElementById("save-simple-btn");

  const editor = document.getElementById("schemes-editor");
  const fileInput = document.getElementById("scheme-file");
  const appendFileBtn = document.getElementById("append-file-btn");
  const appendTextBtn = document.getElementById("append-text-btn");

  function adminHeaders() {
    return { "X-Admin-Token": FarmaSchema.getAdminToken() };
  }

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.dataset.type = type || "";
  }

  function handleAuthFailure(err) {
    // Token was valid at login but has since stopped working (server
    // restarted with a different token, token expired some other way,
    // etc.) — send the admin back to log in again rather than leaving
    // them stuck on a page that can't do anything.
    if (String(err.message || "").toLowerCase().includes("admin token")) {
      FarmaSchema.clearAdminToken();
      window.location.href = "login.html";
      return true;
    }
    return false;
  }

  async function refreshCount() {
    try {
      const data = await FarmaSchema.apiRequest("/api/admin/schemes", {
        headers: adminHeaders(),
      });
      countEl.textContent = `${data.count || 0} schemes currently in database`;
    } catch (err) {
      if (handleAuthFailure(err)) return;
      countEl.textContent = "Could not load scheme count.";
      setStatus(err.message, "error");
    }
  }

  function parseSchemeJson(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err.message}`);
    }

    if (!Array.isArray(parsed) && (parsed === null || typeof parsed !== "object")) {
      throw new Error("JSON must be one scheme object or an array of scheme objects.");
    }

    return parsed;
  }

  function addedCount(schemes) {
    return Array.isArray(schemes) ? schemes.length : 1;
  }

  async function saveSimpleScheme(event) {
    event.preventDefault();

    const name = nameInput.value.trim();
    const description = descriptionInput.value.trim();
    const official_url = urlInput.value.trim();

    if (!name || !description) {
      setStatus("Scheme name and description are both required.", "error");
      return;
    }

    setStatus("Saving scheme...", "");
    saveSimpleBtn.disabled = true;

    try {
      const data = await FarmaSchema.apiRequest("/api/admin/schemes/simple", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ name, description, official_url }),
      });
      countEl.textContent = `${data.count || 0} schemes currently in database`;
      setStatus(`Saved. Assigned ID: ${data.added_id}.`, "success");
      FarmaSchema.showToast("Scheme saved");
      simpleForm.reset();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setStatus(err.message, "error");
    } finally {
      saveSimpleBtn.disabled = false;
    }
  }

  async function appendSchemes(schemes, sourceLabel) {
    setStatus(`Appending ${sourceLabel}...`, "");
    appendFileBtn.disabled = true;
    appendTextBtn.disabled = true;

    try {
      const data = await FarmaSchema.apiRequest("/api/admin/schemes", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ schemes }),
      });
      const ids = (data.added_ids || []).join(", ");
      countEl.textContent = `${data.count || 0} schemes currently in database`;
      setStatus(`Appended ${addedCount(schemes)} scheme(s). Assigned ID(s): ${ids}.`, "success");
      FarmaSchema.showToast("Scheme data appended");
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setStatus(err.message, "error");
    } finally {
      appendFileBtn.disabled = false;
      appendTextBtn.disabled = false;
    }
  }

  async function appendFromFile() {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      setStatus("Choose a JSON file first.", "error");
      return;
    }

    try {
      const text = await file.text();
      const schemes = parseSchemeJson(text);
      await appendSchemes(schemes, "file JSON");
      fileInput.value = "";
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  async function appendFromText() {
    const raw = editor.value.trim();
    if (!raw) {
      setStatus("Write or paste JSON first.", "error");
      return;
    }

    try {
      const schemes = parseSchemeJson(raw);
      await appendSchemes(schemes, "written JSON");
      editor.value = "";
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  function logout() {
    FarmaSchema.clearAdminToken();
    window.location.href = "login.html";
  }

  simpleForm.addEventListener("submit", saveSimpleScheme);
  appendFileBtn.addEventListener("click", appendFromFile);
  appendTextBtn.addEventListener("click", appendFromText);
  logoutBtn.addEventListener("click", logout);

  refreshCount();
})();
