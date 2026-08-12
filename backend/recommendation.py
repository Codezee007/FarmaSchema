"""
recommendation.py
------------------
This file is the "brain" of FarmaSchema. It does two separate jobs, and it is
important to keep them separate so the logic stays easy to explain to judges:

1. ML RELEVANCE SCORING (TF-IDF + cosine similarity)
   We turn the farmer's profile into a short piece of text, and we turn each
   scheme's description into a piece of text. We then use TF-IDF to convert
   both pieces of text into numeric vectors, and cosine similarity to measure
   how "close" the farmer's text is to each scheme's text. This produces the
   "relevance_score" (a number between 0 and 1).

2. RULE-BASED EXPLAINABILITY (matched_attributes / unknown_or_missing)
   Separately, we check simple, transparent rules: does the farmer's state,
   crop, category, land size and irrigation status match what the scheme
   states? This produces a human-readable list like:
       ["State: Karnataka matches", "Crop: Rice matches"]
   and a list of things we could not confirm, like:
       ["Land ownership status: Not provided"]

Both pieces of information are returned together for every scheme, but they
are calculated independently. This keeps each part small and understandable.
"""

import json
import os
import tempfile
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Path to the schemes data file, relative to this file (works no matter
# which folder you run the script from).
SCHEMES_FILE = os.path.join(os.path.dirname(__file__), "data", "schemes.json")


def load_schemes():
    """Load the list of scheme dictionaries from the JSON data file."""
    with open(SCHEMES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_schemes(schemes):
    """Persist the scheme list after validating its basic structure."""
    validate_schemes(schemes)

    data_dir = os.path.dirname(SCHEMES_FILE)
    os.makedirs(data_dir, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(prefix="schemes-", suffix=".json", dir=data_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(schemes, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(temp_path, SCHEMES_FILE)
    except Exception:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise


def append_schemes(new_schemes):
    """Append one or more schemes to the existing scheme list."""
    if isinstance(new_schemes, dict):
        new_schemes = [new_schemes]
    elif not isinstance(new_schemes, list):
        raise ValueError("New scheme data must be a JSON object or array.")

    schemes = load_schemes()
    adjusted_schemes = assign_append_ids(schemes, new_schemes)
    combined = schemes + adjusted_schemes
    save_schemes(combined)
    return combined, adjusted_schemes


def assign_append_ids(existing_schemes, new_schemes):
    """
    Copy incoming schemes and assign sequential numeric ids before saving.

    Existing seed data uses slug ids, so if there are no numeric ids yet we
    start from len(existing_schemes) + 1. Once numeric ids exist, the next
    append continues from the largest numeric id.
    """
    next_id = next_numeric_scheme_id(existing_schemes)
    adjusted = []

    for scheme in new_schemes:
        if not isinstance(scheme, dict):
            raise ValueError("Each appended scheme must be an object.")

        adjusted_scheme = dict(scheme)
        adjusted_scheme["id"] = str(next_id)
        adjusted.append(adjusted_scheme)
        next_id += 1

    return adjusted


def build_simple_scheme(name, description, official_url):
    """
    Build a full scheme record from just the three plain-text fields an
    admin types in on the "Add a scheme" form: name, description,
    official_url.

    IMPORTANT — this is the "plain text, no structured parsing" path:
    we do NOT read the description paragraph and try to figure out its
    state/crop/benefit/eligibility fields. That would be structured
    parsing (OCR/NLP/LLM extraction), which this project deliberately
    skips. Instead:
      - The description is stored exactly as the admin typed it, and is
        the text the TF-IDF step (build_scheme_text) uses directly.
      - Every structured field the rest of the app expects (states,
        crops, farmer_categories, etc.) gets a permissive default
        instead of being guessed at, so this scheme still shows up for
        farmers rather than silently being excluded.
    An admin who wants precise structured fields can still use the
    "Advanced: structured JSON" option below to set them manually.
    """
    name = (name or "").strip()
    description = (description or "").strip()
    official_url = (official_url or "").strip()

    if not name:
        raise ValueError("Scheme name is required.")
    if not description:
        raise ValueError("Scheme description is required.")

    short_description = (
        description if len(description) <= 160
        else description[:157].rstrip() + "..."
    )

    return {
        "name": name,
        "short_description": short_description,
        "description": description,
        "benefits": "",
        "eligibility": [],
        "states": ["All States"],
        "crops": ["All Crops"],
        "farmer_categories": ["All Farmers"],
        "min_land_acres": None,
        "max_land_acres": None,
        "irrigation_required": "Any",
        "application_process": "See the official scheme website for the current application process.",
        "official_url": official_url,
        "verify_note": (
            "Added via the plain-text admin form — verify current details "
            "on the official website before relying on this scheme."
        ),
    }


def append_simple_scheme(name, description, official_url):
    """Plain-text add: build a full scheme record, then append it like any other."""
    scheme = build_simple_scheme(name, description, official_url)
    schemes, added_schemes = append_schemes(scheme)
    return schemes, added_schemes[0]


def next_numeric_scheme_id(schemes):
    """Return the next id number after the largest numeric scheme id."""
    numeric_ids = []

    for scheme in schemes:
        scheme_id = scheme.get("id") if isinstance(scheme, dict) else None
        if isinstance(scheme_id, int):
            numeric_ids.append(scheme_id)
        elif isinstance(scheme_id, str) and scheme_id.isdigit():
            numeric_ids.append(int(scheme_id))

    if numeric_ids:
        return max(numeric_ids) + 1
    return len(schemes) + 1


def validate_schemes(schemes):
    """Keep the admin editor from saving malformed scheme data."""
    if not isinstance(schemes, list):
        raise ValueError("Scheme data must be a JSON array.")

    required_fields = [
        "id",
        "name",
        "short_description",
        "description",
        "benefits",
        "eligibility",
        "states",
        "crops",
        "farmer_categories",
        "application_process",
        "official_url",
    ]
    list_fields = ["eligibility", "states", "crops", "farmer_categories"]
    seen_ids = set()

    for index, scheme in enumerate(schemes, start=1):
        if not isinstance(scheme, dict):
            raise ValueError(f"Scheme #{index} must be an object.")

        missing = [field for field in required_fields if field not in scheme]
        if missing:
            raise ValueError(f"Scheme #{index} is missing: {', '.join(missing)}.")

        scheme_id = str(scheme.get("id", "")).strip()
        if not scheme_id:
            raise ValueError(f"Scheme #{index} must have a non-empty id.")
        if scheme_id in seen_ids:
            raise ValueError(f"Duplicate scheme id: {scheme_id}.")
        seen_ids.add(scheme_id)

        for field in list_fields:
            if not isinstance(scheme.get(field), list):
                raise ValueError(f"Scheme '{scheme_id}' field '{field}' must be a list.")

        for field in ("min_land_acres", "max_land_acres"):
            value = scheme.get(field)
            if value is not None and not isinstance(value, (int, float)):
                raise ValueError(f"Scheme '{scheme_id}' field '{field}' must be a number or null.")


def classify_land_category(land_size_acres):
    """
    Classify a land size (in acres) into the standard Indian farmer
    categories. This is only used as a helpful hint — it never overrides
    what the farmer selects in the profile form.
    Roughly: marginal < 2.5 acres, small 2.5-5, medium 5-25, large > 25.
    """
    if land_size_acres is None:
        return None
    if land_size_acres < 2.5:
        return "Marginal Farmer"
    if land_size_acres < 5:
        return "Small Farmer"
    if land_size_acres < 25:
        return "Medium Farmer"
    return "Large Farmer"


def build_farmer_text(profile):
    """
    Turn a farmer profile dict into a single text string for TF-IDF.

    We repeat the important fields (state, crop, category) a couple of
    times. This is a simple, explainable trick: TF-IDF gives more weight
    to words that appear more often in a document, so repeating the
    farmer's key facts makes sure they count strongly in the comparison,
    instead of being drowned out by generic words like "farmer" or
    "scheme" that appear in almost every document.
    """
    state = profile.get("state", "") or ""
    district = profile.get("district", "") or ""
    crop = profile.get("crop", "") or ""
    category = profile.get("category", "") or ""
    land_size = profile.get("land_size")
    irrigation = profile.get("irrigation", "") or ""
    details = profile.get("details", "") or ""

    irrigation_text = "irrigated irrigation available" if str(irrigation).lower() == "yes" else "rain-fed no irrigation"

    parts = [
        state, state,
        district,
        crop, crop,
        category, category,
        irrigation_text,
        f"{land_size} acres" if land_size is not None else "",
        details,
    ]
    return " ".join(str(p) for p in parts if p).strip()


def build_scheme_text(scheme):
    """
    Turn a scheme dict into a single text string for TF-IDF.

    Like build_farmer_text, we repeat the scheme's states/crops/categories
    so they carry meaningful weight in the comparison against the farmer's
    profile text.
    """
    states = " ".join(scheme.get("states", []) or [])
    crops = " ".join(scheme.get("crops", []) or [])
    categories = " ".join(scheme.get("farmer_categories", []) or [])
    eligibility = " ".join(scheme.get("eligibility", []) or [])

    parts = [
        scheme.get("name", ""),
        scheme.get("short_description", ""),
        scheme.get("description", ""),
        scheme.get("benefits", ""),
        eligibility,
        states, states,
        crops, crops,
        categories, categories,
        scheme.get("land_size_info", ""),
        scheme.get("irrigation_info", ""),
    ]
    return " ".join(str(p) for p in parts if p).strip()


def compute_relevance_scores(profile, schemes):
    """
    Core ML step: TF-IDF + cosine similarity.

    We build ONE TF-IDF vectorizer fitted on all the documents together
    (the farmer's text plus every scheme's text). Fitting on all documents
    together is what lets TF-IDF learn which words are common (like
    "farmer", "scheme", "support") and which are distinctive (like
    "Karnataka", "beekeeping", "drip"). Common words get a lower weight,
    distinctive words get a higher weight.

    Returns a list of floats (relevance scores between 0 and 1), in the
    same order as the `schemes` list passed in.
    """
    farmer_text = build_farmer_text(profile)
    scheme_texts = [build_scheme_text(s) for s in schemes]

    # All documents together, farmer profile first.
    all_documents = [farmer_text] + scheme_texts

    # stop_words="english" removes common English words (the, and, of, ...)
    # so they don't dilute the comparison.
    vectorizer = TfidfVectorizer(stop_words="english")
    tfidf_matrix = vectorizer.fit_transform(all_documents)

    # Row 0 is the farmer's vector, the rest are the schemes' vectors.
    farmer_vector = tfidf_matrix[0:1]
    scheme_vectors = tfidf_matrix[1:]

    # cosine_similarity returns values from -1 to 1, but with TF-IDF
    # (non-negative weights) the result is always between 0 and 1.
    similarities = cosine_similarity(farmer_vector, scheme_vectors)[0]
    return similarities.tolist()


def rule_based_match(profile, scheme):
    """
    Second, independent step: simple transparent rule checks.

    For each attribute (state, crop, category, land size, irrigation) we
    check whether the farmer's profile satisfies what the scheme states.
    If the farmer did not provide a piece of information, we NEVER assume
    they are eligible — we mark it as "Not provided" instead.

    Returns (matched_attributes, unknown_or_missing) — two lists of
    human-readable strings.
    """
    matched = []
    unknown = []

    # --- State ---
    scheme_states = scheme.get("states", []) or []
    farmer_state = (profile.get("state") or "").strip()
    if not farmer_state:
        unknown.append("State: Not provided")
    elif "All States" in scheme_states or farmer_state in scheme_states:
        matched.append(f"State: {farmer_state} matches")
    else:
        unknown.append(f"State: {farmer_state} not listed for this scheme")

    # --- Crop ---
    scheme_crops = scheme.get("crops", []) or []
    farmer_crop = (profile.get("crop") or "").strip()
    if not farmer_crop:
        unknown.append("Crop: Not provided")
    elif "All Crops" in scheme_crops or any(
        farmer_crop.lower() == c.lower() for c in scheme_crops
    ):
        matched.append(f"Crop: {farmer_crop} matches")
    else:
        unknown.append(f"Crop: {farmer_crop} not specifically listed for this scheme")

    # --- Farmer category ---
    scheme_categories = scheme.get("farmer_categories", []) or []
    farmer_category = (profile.get("category") or "").strip()
    if not farmer_category:
        unknown.append("Farmer category: Not provided")
    elif "All Farmers" in scheme_categories or farmer_category in scheme_categories:
        matched.append(f"Category: {farmer_category} matches")
    else:
        unknown.append(f"Category: {farmer_category} not specifically listed for this scheme")

    # --- Land size ---
    land_size = profile.get("land_size")
    min_land = scheme.get("min_land_acres")
    max_land = scheme.get("max_land_acres")
    if land_size is None:
        unknown.append("Land size: Not provided")
    else:
        within_min = (min_land is None) or (land_size >= min_land)
        within_max = (max_land is None) or (land_size <= max_land)
        if within_min and within_max:
            matched.append(f"Land size: {land_size} acres fits this scheme's range")
        else:
            unknown.append(f"Land size: {land_size} acres may be outside this scheme's stated range")

    # --- Irrigation ---
    scheme_irrigation = scheme.get("irrigation_required", "Any")
    farmer_irrigation = profile.get("irrigation")
    if farmer_irrigation is None or farmer_irrigation == "":
        unknown.append("Irrigation availability: Not provided")
    elif scheme_irrigation == "Any":
        matched.append("Irrigation: not a requirement for this scheme")
    elif str(farmer_irrigation).lower() == str(scheme_irrigation).lower():
        matched.append(f"Irrigation: matches requirement ({scheme_irrigation})")
    else:
        unknown.append(f"Irrigation: this scheme expects '{scheme_irrigation}'")

    # Land ownership is commonly required by real schemes but our simple
    # profile form does not collect it — always flag it honestly rather
    # than silently assuming the farmer owns the land.
    unknown.append("Land ownership / title status: Not provided")

    return matched, unknown


def recommend(profile, top_n=None):
    """
    Main entry point used by the Flask API.

    1. Loads all schemes.
    2. Computes a TF-IDF + cosine similarity relevance score for each one.
    3. Computes the rule-based matched/unknown attributes for each one.
    4. Sorts schemes by relevance_score, highest first.
    5. Returns a list of result dictionaries ready to be turned into JSON.
    """
    schemes = load_schemes()
    scores = compute_relevance_scores(profile, schemes)

    results = []
    for scheme, score in zip(schemes, scores):
        matched, unknown = rule_based_match(profile, scheme)
        results.append({
            "id": scheme["id"],
            "name": scheme["name"],
            "short_description": scheme["short_description"],
            "relevance_score": round(float(score), 4),
            "matched_attributes": matched,
            "unknown_or_missing": unknown,
            "official_url": scheme.get("official_url", ""),
        })

    results.sort(key=lambda r: r["relevance_score"], reverse=True)

    if top_n is not None:
        results = results[:top_n]

    return results


if __name__ == "__main__":
    # Quick manual test — run this file directly with:
    #   python recommendation.py
    # to confirm the recommendation logic works before wiring up Flask.
    sample_profile = {
        "state": "Karnataka",
        "district": "Bengaluru Rural",
        "crop": "Rice",
        "land_size": 2,
        "category": "Small Farmer",
        "irrigation": "Yes",
        "details": "",
    }

    print("Sample farmer profile:", sample_profile)
    print("Farmer TF-IDF text  :", build_farmer_text(sample_profile))
    print()

    recommendations = recommend(sample_profile, top_n=5)
    for i, rec in enumerate(recommendations, start=1):
        print(f"{i}. {rec['name']}  (relevance_score={rec['relevance_score']})")
        print("   Matched :", rec["matched_attributes"])
        print("   Unknown :", rec["unknown_or_missing"])
        print()
