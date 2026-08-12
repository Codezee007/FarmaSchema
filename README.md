# FarmaSchema

**An Agricultural Scheme Discovery & Matching Tool**

FarmaSchema helps small farmers figure out which government agricultural
schemes they're likely to be relevant for. A farmer fills in a short
profile (state, crop, land-holding category, irrigation), and the tool ranks
20 real central government schemes by relevance using TF-IDF + cosine
similarity, plus a transparent rule-based explanation of *why* each scheme
was matched.

> ⚠️ **This tool provides relevance screening, not legal eligibility.**
> It never guarantees that a farmer qualifies for a scheme. Every scheme
> page tells the user to verify current official criteria before applying.

---

## 1. Project structure

```
FarmaSchema/
│
├── frontend/                  Plain HTML / CSS / vanilla JS — no framework
│   ├── index.html             Landing page
│   ├── dashboard.html         Farmer profile form + ranked results
│   ├── scheme.html            Browse all schemes / scheme details
│   ├── saved.html             Saved/bookmarked schemes page
│   ├── login.html             Admin login page (token check)
│   ├── admin.html             Admin page: add scheme (plain text or advanced JSON)
│   ├── css/
│   │   └── style.css          Shared site styling
│   └── js/
│       ├── app.js             Shared helpers, client ID, API wrapper and common UI helpers
│       ├── dashboard.js       Farmer form handling + ranked recommendation rendering
│       ├── scheme.js          Browse grid + individual scheme detail rendering
│       ├── saved.js           Saved schemes page + bookmark loading/removal
│       ├── i18n.js             22-language localization and state-to-language mapping
│       ├── login.js            Admin login form
│       └── admin.js            Add-scheme form + advanced JSON upload/paste
│
├── backend/
│   ├── app.py                 Flask REST API + serves the frontend
│   ├── recommendation.py      TF-IDF + cosine similarity + rule-based matching
│   ├── database.py            SQLite bookmark/database helpers
│   ├── data/
│   │   ├── schemes.json       Scheme database used by recommendations
│   │   └── farmaschema.db     Local SQLite database for saved schemes
│   └── requirements.txt
│
├── README.md
└── .gitignore
```

**One deviation from a strict two-server setup, on purpose:** `app.py`
serves the `frontend/` folder as static files *and* the `/api/...`
endpoints, so the whole project runs from **one command in one terminal**.
`flask-cors` is still enabled, so if your team prefers to open the
frontend separately (e.g. with VS Code's "Live Server") while the backend
runs on its own port, that still works with no code changes — just update
the fetch URLs in `js/app.js` if you do this.

---

## 2. Requirements

* Python 3.9+ already installed
* Windows PowerShell (commands below are PowerShell-exact)

---

## 3. Setup (do this once)

Open PowerShell in the project's root folder (the one containing `frontend/`
and `backend/`), then:

```powershell
cd backend

# Create a virtual environment named "venv"
python -m venv venv

# Activate it
.\venv\Scripts\Activate.ps1
```

> If PowerShell blocks the activation script with an execution-policy
> error, run this once (as your normal user, not admin), then try
> activating again:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

With the venv active (your prompt will show `(venv)`), install the
dependencies:

```powershell
pip install -r requirements.txt
```

---

## 4. Running the app

Everything runs from one terminal, from inside `backend/`, with the venv active:

```powershell
python app.py
```

You should see Flask start up and print something like
`Running on http://127.0.0.1:5000`. Open that URL in your browser —
you'll see the FarmaSchema landing page. The frontend and the API are both
being served by this one process, so there is nothing else to start.

To stop the server, go back to the PowerShell window and press `Ctrl + C`.

Next time you want to run it, you only need:

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python app.py
```

If port `5000` is already in use, you can choose another port:

```powershell
$env:PORT="5050"
python app.py
```

---

## 4.1 Admin scheme updates

The admin section is available through a separate link in the site header,
or directly at:

```text
http://127.0.0.1:5000/login.html
```

Log in with the admin token. On success the token is kept in
`sessionStorage` for that browser tab only (closing the tab signs you
out), and you're taken to `admin.html`.

**Adding a scheme is plain text — no structured parsing.** The main admin
form asks for exactly three things:

1. Scheme name
2. Scheme description — paste the paragraph as written on the official
   source; it's stored exactly as typed
3. Official website URL

Nothing is auto-extracted from the description (no OCR/NLP/LLM parsing).
The description is stored as-is and is the text the TF-IDF matching step
uses directly. Structured fields the rest of the app expects (states,
crops, farmer categories, etc.) get permissive defaults (`"All States"`,
`"All Crops"`, `"All Farmers"`) so the new scheme still shows up for
farmers instead of being silently excluded.

If you need to set those structured fields precisely instead of using the
defaults, use the **"Advanced: add structured JSON"** section further down
the same page — it's the same two options as before (upload a `.json`
file, or paste JSON directly), unchanged.

Both the plain-text form and the advanced JSON options append to
`backend/data/schemes.json`. The backend validates required fields,
replaces any incoming `id` with the next numeric ID, and then saves the
adjusted scheme data. If the current dataset has no numeric IDs yet, the
first appended scheme starts at the current scheme count + 1.

For local development, the default admin token is:

```text
dev-admin-token
```

Before a demo outside your machine or any deployment, set a stronger token:

```powershell
$env:FARMASCHEMA_ADMIN_TOKEN="your-strong-token"
python app.py
```

---

## 5. Verifying each part works (do these in order)

**a) Test the ML recommendation logic on its own, no server needed:**

```powershell
cd backend
python recommendation.py
```

You should see a sample farmer profile followed by a ranked list of
schemes with relevance scores and matched/unknown attributes printed to
the terminal.

**b) Test the API once the server is running** (`python app.py` in one
window), open a **second** PowerShell window and run:

```powershell
curl http://127.0.0.1:5000/api/health
curl http://127.0.0.1:5000/api/schemes
curl http://127.0.0.1:5000/api/schemes/pm-kisan
```

To test the admin API count/data endpoint:

```powershell
curl -H "X-Admin-Token: dev-admin-token" http://127.0.0.1:5000/api/admin/schemes
```

**c) Test the full flow in the browser:**

1. Go to `http://127.0.0.1:5000/`
2. Click "Find government schemes"
3. Fill in the form (try: Karnataka, Rice, 2 acres, Small Farmer, Irrigation: Yes)
4. Click "Find matching schemes" — you should see a ranked list with
   relevance percentages and a "Why this scheme?" dropdown on each card
5. Click "View details" on any card — you should land on that scheme's
   detail page with your personal relevance score in the sidebar
6. Click the ☆ bookmark button on a card or detail page — it should turn
   into ★ and a toast should confirm it

If step (c) fails but steps (a) and (b) work, the problem is almost
certainly in the frontend JS or the browser console (open DevTools →
Console to see the real error) — not in the ML or the API.

---

## 6. How the ML pipeline works (for judges / your presentation)

1. The farmer's profile (state, district, crop, land size, category,
   irrigation, free-text details) is converted into one plain-text string,
   with the key fields repeated so they carry more weight.
2. Every scheme's description, benefits, eligibility text, states, crops
   and categories are similarly converted into one text string per scheme.
3. **TfidfVectorizer** (scikit-learn) turns all of these text strings into
   numeric vectors, weighting distinctive words (like "Karnataka" or
   "beekeeping") more heavily than common words (like "farmer" or
   "scheme").
4. **cosine_similarity** measures the angle between the farmer's vector
   and each scheme's vector — a value from 0 (unrelated) to 1 (very
   similar). This becomes the `relevance_score`.
5. **Separately**, a simple rule-based layer checks the farmer's state,
   crop, category, land size and irrigation directly against each
   scheme's stated criteria, and produces `matched_attributes` (things
   that line up) and `unknown_or_missing` (things we can't confirm — we
   never assume eligibility when information wasn't provided).
6. Schemes are ranked by `relevance_score`, and every card in the UI
   shows the score plus the plain-language reasons behind it.

This is intentionally simple (no embeddings, no deep learning) so it's
easy to explain and easy to defend under questioning.

---

## 7. API reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Confirms the backend is running |
| GET | `/api/schemes` | All schemes (used by the browse page) |
| GET | `/api/schemes/<id>` | One scheme's full details |
| POST | `/api/recommend` | Body: farmer profile JSON → ranked recommendations |
| POST | `/api/bookmark` | Body: `{client_id, scheme_id, action}` (`action`: `add` or `remove`) |
| GET | `/api/bookmarks?client_id=...` | All bookmarks for that browser |
| GET | `/api/admin/schemes` | Admin-only: return the scheme dataset |
| POST | `/api/admin/schemes` | Admin-only: append one scheme object or an array of scheme objects |
| PUT | `/api/admin/schemes` | Admin-only: replace the full scheme dataset |
| POST | `/api/admin/schemes/simple` | Admin-only: plain-text add — body `{name, description, official_url}`, no parsing |

---

## 8. Privacy

No Aadhaar number, phone number, bank details or password is ever
collected. Bookmarks are tied to a random `client_id` generated in the
browser's `localStorage` — not to any personal identifier.

Local runtime files such as `backend/data/farmaschema.db`, Python
`__pycache__/` folders, virtual environments, `.env` files and logs are
ignored through `.gitignore`.

---

## 9. Known limitations (worth mentioning proactively to judges)

* Scheme data (benefits, exact percentages, portals) reflects general,
  well-established scheme information but is **not a live feed from any
  government API** — every scheme has a `verify_note` for this reason.
* TF-IDF is a text-similarity technique, not a legal-eligibility engine —
  this is why the rule-based layer and the disclaimers exist alongside it.
* The rule-based layer is intentionally simple (state / crop / category /
  land size / irrigation) — it does not model complex real eligibility
  conditions like income ceilings or land-ownership documentation.
* The admin section uses a lightweight token check intended for demos and
  local development, not a full user/account permission system.
* `debug=True` and open CORS are convenient during development, but should
  be tightened before deployment.

---

## 10. Implemented farmer features

The farmer-facing application now includes the following implemented features:

### 10.1 Multi-language support

* A persistent **language selector** is available in the site header and on the
  landing page.
* The selector supports all **22 languages in the Eighth Schedule of the
  Constitution of India**, with Indian-language names used in the interface.
* The selected language is stored in browser `localStorage` as
  `farmaschema_language`, so the preference persists across pages and sessions.
* A **state-to-primary-language map** is available through the language UI.
  Selecting a state can automatically select its associated primary language.
* `frontend/js/i18n.js` contains the presentation-layer localization system.
* UI labels, navigation, forms, messages, scheme-related interface text and
  other supported frontend content are localized without changing the
  underlying recommendation data.
* English scheme data remains the canonical source. Where a translation is
  unavailable, the application safely falls back to the canonical English
  text.
* Language changes do **not** change TF-IDF scores, recommendation ranking,
  farmer profile data, or bookmark identity. This keeps recommendations
  language-independent while allowing the interface and displayed scheme
  content to follow the selected language.

### 10.2 Farmer profile improvements

The dashboard uses one land-holding category dropdown with these ranges:

* Marginal: below 2.5 acres (below 1 hectare)
* Small: 2.5 to below 5 acres (1 to below 2 hectares)
* Semi-Medium: 5 to below 10 acres (2 to below 4 hectares)
* Medium: 10 to 25 acres (4 to 10 hectares)
* Large: above 25 acres (10 hectares and above)

The frontend converts the selected range into the existing `category` and
representative `land_size` fields expected by `/api/recommend`; the backend
recommendation algorithm and database schema remain unchanged.

### 10.3 Saved schemes / bookmarks

A dedicated **Saved Schemes** page is available from the site header.

* `saved.html` provides the Saved Schemes page.
* `saved.js` loads and renders the schemes saved by the current browser.
* Saved schemes reuse the existing random `client_id` and the existing
  `/api/bookmarks` and `/api/bookmark` endpoints.
* Users can save or remove a scheme from recommendation cards and scheme
  detail pages.
* Bookmarks remain language-independent, while the displayed scheme content
  follows the currently selected language.
* The SQLite database stores the bookmark information locally; no personal
  identity such as Aadhaar or phone number is required.

### 10.4 Existing recommendation flow remains unchanged

The new language and saved-scheme features are frontend/user-experience
features around the existing recommendation system. The core TF-IDF +
cosine-similarity recommendation pipeline and its rule-based explanation
layer remain unchanged.

