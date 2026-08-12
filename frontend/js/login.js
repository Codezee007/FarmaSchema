/*
  login.js
  --------
  Handles the admin login page.

  There's no separate username/password account system here (see
  README's "Known limitations" — the admin check is a single shared
  token, intended for demos/local development). This page just gives
  that token check a proper login flow: the admin types the token once,
  we verify it against the backend, and — if it works — store it in
  sessionStorage so admin.html doesn't ask again for the rest of the tab
  session.
*/
(function () {
  const form = document.getElementById("login-form");
  const tokenInput = document.getElementById("admin-token");
  const loginBtn = document.getElementById("login-btn");
  const statusEl = document.getElementById("login-status");

  // Already logged in this tab? Skip straight to the admin page.
  if (FarmaSchema.getAdminToken()) {
    window.location.href = "admin.html";
    return;
  }

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.dataset.type = type || "";
  }

  async function handleLogin(event) {
    event.preventDefault();

    const token = tokenInput.value.trim();
    if (!token) {
      setStatus("Enter the admin token first.", "error");
      return;
    }

    loginBtn.disabled = true;
    setStatus("Checking token...", "");

    try {
      // Any admin-only endpoint works as a token check; this one also
      // happens to be harmless (read-only).
      await FarmaSchema.apiRequest("/api/admin/schemes", {
        headers: { "X-Admin-Token": token },
      });
      FarmaSchema.setAdminToken(token);
      window.location.href = "admin.html";
    } catch (err) {
      setStatus(err.message, "error");
      loginBtn.disabled = false;
    }
  }

  form.addEventListener("submit", handleLogin);
})();
