##############################################
# icg.py — ICGenealogy channel database client
#
# Two data sources:
#   1. moose.channels — search corpus (ion_class, suffix, year, authors, gbar)
#   2. ICG REST API   — detail panel enrichment (classifications, notes, traces)
##############################################
import json
import re
import threading
import time
import traceback
from pathlib import Path

try:
    import moose.channels as _mchan
except (ImportError, ModuleNotFoundError):
    _mchan = None

import httpx

ICG_API = "https://icg.neurotheory.ox.ac.uk/api/app"
_ICG_SEARCH_URL = ICG_API + "/search/"

_FAMILY_BY_ION_CLASS = {'K': 1, 'Na': 2, 'Ca': 3, 'IH': 4, 'KCa': 5}

def _source_label(authors, year) -> str:
    """'Traub RD, Buhl EH, ...', 2003 -> 'ICG/Traub RD et al. 2003'.

    Two-author papers keep both: 'ICG/Hodgkin AL & Huxley AF 1952'.
    """
    names = [a.strip() for a in (authors or '').split(',') if a.strip()]
    if len(names) > 2:
        who = f'{names[0]} et al.'
    else:
        who = ' & '.join(names)
    label = ' '.join(filter(None, [who, str(year or '').strip()]))
    return f'ICG/{label}' if label else 'ICG'

_USER_UPLOADS_DIR = Path(__file__).resolve().parent.parent / "user_uploads"

# ── Lazy singletons ───────────────────────────────────────────────────────────
_opt_lock = threading.Lock()

_options = None


# ── ICG REST API helpers ──────────────────────────────────────────────────────

def _icg_get(url: str, timeout: float = 15, retries: int = 2) -> httpx.Response:
    for attempt in range(retries + 1):
        try:
            with httpx.Client() as client:
                return client.get(url, timeout=timeout)
        except (httpx.TimeoutException, httpx.ConnectError):
            if attempt == retries:
                raise
            time.sleep(1.5 ** attempt)


def _fetch_icg_channel_detail(icg_id: int, fid) -> dict:
    resp = _icg_get(f"{ICG_API}/chs/{icg_id}/", timeout=10)
    if not resp.is_success:
        raise ValueError(f"ICG API returned {resp.status_code}")
    data = resp.json()
    if data.get("has_traces") and fid:
        data["trace_img_base"] = (
            f"https://icg.neurotheory.ox.ac.uk/static/icg/traces/{fid}_{icg_id}"
        )
    return data


def _icg_resolve_by_modeldb(modeldb_id: int) -> list:
    """Live lookup: modeldb_id -> [{icg_id, icg_suffix, ion_class}].

    Uses the same /search/?q= endpoint moose.channels' own build_icg_meta.py
    script uses to build its bundled CSV, so it stays a fallback resolver
    rather than the primary path — a caller that already has icg_id should
    go straight to _fetch_icg_channel_detail instead.
    """
    try:
        resp = _icg_get(f"{_ICG_SEARCH_URL}?q={modeldb_id}", timeout=10)
    except Exception:
        traceback.print_exc()
        return []
    if not resp or not resp.is_success:
        return []
    prefix = f"{modeldb_id}-"
    out = []
    for s in resp.json().get("suggestions", []):
        val = s.get("value", "")
        if not val.startswith(prefix):
            continue
        rest = val[len(prefix):]                     # "cagk [id: 3, class: KCa]"
        icg_suffix = rest.split(" ")[0]
        m = re.search(r"class:\s*(\w+)", rest)
        try:
            icg_id = json.loads(s["data"])[0]
        except Exception:
            continue
        out.append({"icg_id": icg_id, "icg_suffix": icg_suffix,
                    "ion_class": m.group(1) if m else ""})
    return out


def _best_suffix_match(suffix: str, candidates: list) -> dict:
    """Priority: exact > either-way prefix > substring (mirrors
    moose.channels' build_icg_meta.py matching logic)."""
    lo = (suffix or "").lower()
    for c in candidates:
        if c["icg_suffix"].lower() == lo:
            return c
    for c in candidates:
        if c["icg_suffix"].lower().startswith(lo):
            return c
    for c in candidates:
        if lo.startswith(c["icg_suffix"].lower()):
            return c
    for c in candidates:
        icg_lo = c["icg_suffix"].lower()
        if lo in icg_lo or icg_lo in lo:
            return c
    return None


# ── Public API ────────────────────────────────────────────────────────────────

def get_options() -> dict:
    if _mchan is None:
        raise RuntimeError("moose.channels is not available — install pymoose")
    global _options
    if _options is not None:
        return _options
    with _opt_lock:
        if _options is not None:
            return _options
        all_results = _mchan.search(show=False)
        suffixes, years = set(), set()
        suffixes_by_class = {}
        for model in all_results:
            meta = model.get("meta", {})
            y = str(meta.get("year", "")).strip()
            if y:
                years.add(y)
            for suffix, gates in model.get("channels", {}).items():
                if suffix:
                    suffixes.add(suffix)
                ic = gates[0].get("ion_class", "") if gates else ""
                if ic:
                    suffixes_by_class.setdefault(ic, set()).add(suffix)
        _options = {
            "ion_classes":       _mchan.list_ion_classes(),
            "suffixes":          sorted(suffixes),
            "suffixes_by_class": {ic: sorted(s) for ic, s in suffixes_by_class.items()},
            "years":             sorted(years),
        }
    return _options


def search_channels(ion_class="", suffix="", author="", year="",
                    modeldb_id=None, icg_id="", sort_by="", sort_dir="desc",
                    page=0, size=None) -> dict:
    if _mchan is None:
        raise RuntimeError("moose.channels is not available — install pymoose")

    mid_int    = int(modeldb_id) if str(modeldb_id or "").isdigit() else None
    icg_id_int = int(icg_id)     if str(icg_id or "").isdigit()     else None

    csv_results = _mchan.search(
        ion_class=ion_class or None,
        suffix=suffix       or None,
        author=author       or None,
        year=year           or None,
        modeldb_id=mid_int,
        icg_id=icg_id_int,
        show=False,
    )

    rows = []
    for model in csv_results:
        mid  = model["modeldb_id"]
        meta = model.get("meta", {})
        for sfx, gates in model.get("channels", {}).items():
            g0  = gates[0] if gates else {}
            raw_icg_id = g0.get("icg_id", "") or meta.get("icg_id", "")
            _cc = meta.get("citation_count", "")
            title = meta.get("title", "")
            rows.append({
                "id":            f"{mid}_{sfx}",
                "modeldb_id":    mid,
                "icg_id":        raw_icg_id,
                "fid":           _FAMILY_BY_ION_CLASS.get(g0.get("ion_class", "")),
                "suffix":        sfx,
                "icg_suffix":    sfx,
                "ion_class":     g0.get("ion_class", ""),
                "source":        _source_label(meta.get("authors", ""), meta.get("year", "")),
                "authors":       meta.get("authors", ""),
                "year":          str(meta.get("year", "")).strip(),
                "title":         title,
                "description":   title,
                "pubmedid":      meta.get("pubmedid", ""),
                "gbar_default":  float(g0["gbar_default"]) if g0.get("gbar_default") else None,
                "has_omnimodel": True,
                "in_icg":        bool(raw_icg_id),
                "cites":         int(_cc) if str(_cc).isdigit() else 0,
            })

    if sort_by in ("cites", "year"):
        rows.sort(
            key=lambda r: (r.get(sort_by) or 0) if sort_by == "cites" else (r.get(sort_by) or ""),
            reverse=(sort_dir != "asc"),
        )

    total = len(rows)
    page_rows = rows if size is None else rows[page * size: page * size + size]
    return {"channels": page_rows, "total": total, "page": page}


def get_channel_detail(modeldb_id=None, suffix=None, icg_id=None) -> dict:
    """Model detail preview — always sourced live from the ICG REST API.

    When icg_id is already known, one call to the detail endpoint suffices
    (it returns id_moddb/name itself); otherwise resolve icg_id from
    modeldb_id/suffix via a live search first.
    """
    fid = None
    if icg_id is None:
        if modeldb_id is None:
            return {'fields': []}
        match = _best_suffix_match(suffix, _icg_resolve_by_modeldb(int(modeldb_id)))
        if not match:
            return {'fields': [
                {'label': 'ModelDB ID', 'value': str(modeldb_id)},
                {'label': 'Channel',    'value': suffix or ''},
            ]}
        icg_id = match['icg_id']
        fid = _FAMILY_BY_ION_CLASS.get(match['ion_class'])

    # ICG REST API enrichment — mirrors the ICGenealogy detail page layout:
    # General data (ids/citations) → Metadata classes → Metadata generic →
    # Reference (rendered last by the frontend's `references` block).
    try:
        data = _fetch_icg_channel_detail(int(icg_id), fid)
    except Exception:
        traceback.print_exc()
        return {'fields': [
            {'label': 'ModelDB ID', 'value': str(modeldb_id or '')},
            {'label': 'Channel',    'value': suffix or ''},
        ]}

    modeldb_id = modeldb_id or data.get('id_moddb', '')
    suffix     = suffix or data.get('name', '')
    fields = [
        {'label': 'ModelDB ID', 'value': str(modeldb_id)},
        {'label': 'Channel',    'value': str(suffix)},
        {'label': 'ICG ID',     'value': str(icg_id)},
    ]
    result = {'fields': fields}

    ref = data.get('ref')
    if ref and ref.get('citations'):
        fields.append({'label': 'Citations', 'value': str(ref['citations'])})

    for grp in (data.get('cls') or []):
        names = [c['name'] for c in grp.get('cls', []) if c.get('name')]
        if names:
            fields.append({'label': grp['name'], 'value': ', '.join(names)})

    if ref and ref.get('authors'):
        fields.append({'label': 'Authors', 'value': ref['authors']})

    for m in (data.get('metadata') or []):
        if m.get('value'):
            # ICG's "Authors" metadata is the .mod file author, not the paper's
            label = 'Implemented By' if m['name'] == 'Authors' else m['name']
            fields.append({'label': label, 'value': m['value']})

    if ref:
        ref_text = ' '.join(filter(None, [
            ref.get('authors'),
            f"({ref.get('date')})" if ref.get('date') else None,
            ref.get('title'),
        ]))
        if ref_text:
            pmid = ref.get('id_pubmed')
            entry = {'text': ref_text, 'pmid': pmid}
            if pmid:
                entry['url'] = f'https://pubmed.ncbi.nlm.nih.gov/{pmid}/'
            result['references'] = [entry]

    return result


def stage_channel(modeldb_id: int, suffix: str, client_id: str) -> dict:
    dest_dir = _USER_UPLOADS_DIR / client_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    ion_class, description, icg_id, fid = '', '', None, None
    source = 'ICG'
    if _mchan:
        try:
            csv_rows = _mchan.search(modeldb_id=modeldb_id, suffix=suffix, show=False)
            if csv_rows:
                meta      = csv_rows[0].get('meta', {})
                gates     = csv_rows[0].get('channels', {}).get(suffix, [])
                g0        = gates[0] if gates else {}
                ion_class = g0.get('ion_class', '')
                title     = meta.get('title', '')
                year      = str(meta.get('year', '')).strip()
                description = ' '.join(filter(None, [title, f'({year})' if year else None]))
                source    = _source_label(meta.get('authors', ''), year)
                raw = g0.get('icg_id')
                if raw:
                    icg_id = int(raw)
                fid = _FAMILY_BY_ION_CLASS.get(ion_class)
        except Exception:
            traceback.print_exc()

    server_file = f'{suffix}_{modeldb_id}'
    item = {
        'id':          f'icg_{modeldb_id}_{suffix}',
        'name':        f'{suffix}_{modeldb_id}',
        'source':      source,
        'description': description,
        'source_type': 'file',
        'server_file': server_file,
        'modeldb_id':  modeldb_id,
        'suffix':      suffix,
        'icg_id':      str(icg_id or ''),
        'fid':         fid,
        'details':     get_channel_detail(modeldb_id, suffix, icg_id=icg_id),
    }

    path = dest_dir / "user_registry.json"
    try:
        registry = json.loads(path.read_text())
    except FileNotFoundError:
        registry = {}
    except json.JSONDecodeError:
        print(f"[ICG] WARNING: {path} is corrupt — resetting")
        registry = {}
    registry.setdefault("morpho", {"items": []})
    registry.setdefault("chem",   {"items": []})
    section    = registry.setdefault("chan", {"items": []})
    items_list = section.setdefault("items", [])
    for i, existing in enumerate(items_list):
        if existing.get("id") == item["id"]:
            items_list[i] = item
            break
    else:
        items_list.append(item)
    path.write_text(json.dumps(registry, indent=2))
    print(f"[ICG] Saved channel {item['id']} to {path}")

    return {'filename': server_file}
