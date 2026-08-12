"""
app.py
------
The Flask backend for FarmaSchema.

DESIGN NOTE (read this first):
The project brief asks for frontend/ and backend/ to be kept in separate
folders, which we have done. But it does NOT require two separate running
servers — running two servers just adds CORS setup and two terminals to
manage, which is unnecessary risk for a 2-day build. So this Flask app does
two things:
  1. Serves the REST API under /api/...
  2. Also serves the static files inside ../frontend so the whole site runs
     from a single "python app.py" command on http://localhost:5000
flask-cors is still enabled, so if you ever DO want to open the frontend
files separately (e.g. with VS Code Live Server) while this backend runs
on a different port, that will also work without extra changes.
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import os

import database
import recommendation

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
ADMIN_TOKEN = os.environ.get("FARMASCHEMA_ADMIN_TOKEN", "dev-admin-token")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app)  # allow requests from any origin, useful if frontend is served separately

# Create the bookmarks table (if it doesn't exist yet) as soon as the app starts.
database.init_db()


# ---------------------------------------------------------------------------
# Frontend routes (serve the static HTML/CSS/JS files)
# ---------------------------------------------------------------------------

@app.route("/")
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>")
def serve_frontend_file(filename):
    """
    Serves any other frontend file directly, e.g. /dashboard.html,
    /scheme.html, /css/style.css, /js/app.js.
    """
    return send_from_directory(FRONTEND_DIR, filename)


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

def require_admin():
    """Return an error response unless the request has the admin token."""
    token = request.headers.get("X-Admin-Token", "")
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()

    if not ADMIN_TOKEN or token != ADMIN_TOKEN:
        return jsonify({"error": "Admin token is missing or invalid."}), 401
    return None

@app.route("/api/health")
def health():
    """Simple check used to confirm the backend is running."""
    return jsonify({"status": "ok", "message": "FarmaSchema backend is running"})


@app.route("/api/schemes")
def get_all_schemes():
    """Return the full list of schemes (used for the Scheme Status Page)."""
    schemes = recommendation.load_schemes()
    return jsonify({"count": len(schemes), "schemes": schemes})


@app.route("/api/schemes/<scheme_id>")
def get_scheme_by_id(scheme_id):
    """Return one scheme's full details, or a 404 if the id doesn't exist."""
    schemes = recommendation.load_schemes()
    for scheme in schemes:
        if str(scheme["id"]) == scheme_id:
            return jsonify(scheme)
    return jsonify({"error": f"No scheme found with id '{scheme_id}'"}), 404


@app.route("/api/admin/schemes", methods=["GET", "POST", "PUT"])
def admin_schemes():
    """
    Admin-only scheme database editor.

    Reads/writes backend/data/schemes.json, which is the source used by the
    recommendation engine and the public scheme pages.
    """
    auth_error = require_admin()
    if auth_error:
        return auth_error

    if request.method == "GET":
        schemes = recommendation.load_schemes()
        return jsonify({"count": len(schemes), "schemes": schemes})

    body = request.get_json(silent=True)
    if not body or "schemes" not in body:
        return jsonify({"error": "Request body must be JSON with a 'schemes' object or array."}), 400

    try:
        if request.method == "POST":
            schemes, added_schemes = recommendation.append_schemes(body["schemes"])
            return jsonify({
                "status": "appended",
                "count": len(schemes),
                "added_ids": [scheme["id"] for scheme in added_schemes],
            })

        recommendation.save_schemes(body["schemes"])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify({"status": "saved", "count": len(body["schemes"])})


@app.route("/api/admin/schemes/simple", methods=["POST"])
def admin_add_simple_scheme():
    """
    Plain-text scheme add.

    The admin sends just three plain-text fields: name, description,
    official_url. No structured JSON, and no parsing of the description
    paragraph into fields — we store it as-is and let the existing
    TF-IDF step (recommendation.build_scheme_text) use it directly. See
    recommendation.build_simple_scheme for the permissive defaults used
    for the structured fields the rest of the app expects.
    """
    auth_error = require_admin()
    if auth_error:
        return auth_error

    body = request.get_json(silent=True) or {}
    name = body.get("name", "")
    description = body.get("description", "")
    official_url = body.get("official_url", "")

    try:
        schemes, added_scheme = recommendation.append_simple_scheme(name, description, official_url)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify({
        "status": "appended",
        "count": len(schemes),
        "added_id": added_scheme["id"],
    })


@app.route("/api/recommend", methods=["POST"])
def recommend_schemes():
    """
    Accepts a farmer profile and returns schemes ranked by relevance.

    Expected JSON body, e.g.:
    {
      "state": "Karnataka",
      "district": "Bengaluru Rural",
      "crop": "Rice",
      "land_size": 2,
      "category": "Small Farmer",
      "irrigation": "Yes",
      "details": ""
    }
    """
    profile = request.get_json(silent=True)

    if not profile:
        return jsonify({"error": "Request body must be JSON."}), 400

    # --- Basic validation. We keep this simple and friendly on purpose. ---
    required_text_fields = ["state", "crop", "category"]
    missing = [f for f in required_text_fields if not profile.get(f)]
    if missing:
        return jsonify({
            "error": "Missing required field(s).",
            "missing_fields": missing
        }), 400

    land_size = profile.get("land_size")
    if land_size is not None:
        try:
            land_size = float(land_size)
            if land_size < 0:
                raise ValueError()
            profile["land_size"] = land_size
        except (TypeError, ValueError):
            return jsonify({"error": "land_size must be a positive number."}), 400

    recommendations = recommendation.recommend(profile)

    return jsonify({
        "profile": profile,
        "recommendations": recommendations
    })


@app.route("/api/bookmark", methods=["POST"])
def bookmark_scheme():
    """
    Save (or un-save) a bookmark.
    Body: { "client_id": "...", "scheme_id": "...", "action": "add" | "remove" }
    "action" defaults to "add" if not provided.
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Request body must be JSON."}), 400

    client_id = body.get("client_id")
    scheme_id = body.get("scheme_id")
    action = body.get("action", "add")

    if not client_id or not scheme_id:
        return jsonify({"error": "client_id and scheme_id are required."}), 400

    schemes = recommendation.load_schemes()
    scheme = next((s for s in schemes if str(s["id"]) == str(scheme_id)), None)
    if not scheme:
        return jsonify({"error": f"No scheme found with id '{scheme_id}'"}), 404

    if action == "remove":
        database.remove_bookmark(client_id, scheme_id)
        return jsonify({"status": "removed", "scheme_id": scheme_id})
    else:
        database.add_bookmark(client_id, scheme_id, scheme["name"])
        return jsonify({"status": "added", "scheme_id": scheme_id})


@app.route("/api/bookmarks")
def list_bookmarks():
    """Return all bookmarks for a given client_id, e.g. /api/bookmarks?client_id=abc123"""
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"error": "client_id query parameter is required."}), 400
    return jsonify({"bookmarks": database.get_bookmarks(client_id)})


# ---------------------------------------------------------------------------
# Friendly error handlers (so the frontend never sees a raw stack trace)
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found."}), 404
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Something went wrong on the server. Please try again."}), 500


if __name__ == "__main__":
    # debug=True gives auto-reload and helpful error pages while developing.
    # Turn this off (debug=False) before a live demo if you want cleaner output.
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)))
