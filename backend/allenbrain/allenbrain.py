##############################################
# allenbrain.py — Allen Brain Cell Types Database API client
##############################################
import io
import re
import zipfile

import requests

# Characters that have syntactic meaning in RMA filter expressions
_RMA_UNSAFE = re.compile(r"['\[\],]")

_API_BASE         = "http://api.brain-map.org"
_RMA_URL          = "http://api.brain-map.org/api/v2/data/query.json"
_DOWNLOAD_URL     = "http://api.brain-map.org/api/v2/well_known_file_download"
_SWC_FILE_TYPE    = "3DNeuronReconstruction"
_QUERY_TIMEOUT    = 30
_DOWNLOAD_TIMEOUT = 60


def _rma_query(model: str, criteria: str = "", include: str = "", num_rows: str = "all") -> list:
    rma = f"model::{model}"
    if criteria:
        rma += f",rma::criteria,{criteria}"
    if include:
        rma += f",rma::include,{include}"
    rma += f",rma::options[num_rows$eq{num_rows}]"

    resp = requests.get(_RMA_URL, params={"criteria": rma}, timeout=_QUERY_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"Allen RMA error: {data.get('msg', 'Unknown error')}")
    return data.get("msg", [])


# ── Filter / search helpers ───────────────────────────────────────────────────

def _safe_filter_value(value: str) -> str:
    """Reject strings containing RMA metacharacters to prevent query injection."""
    if _RMA_UNSAFE.search(value):
        raise ValueError(f"Invalid filter value: {value!r}")
    return value


def _unique_sorted(rows, key):
    return sorted({r[key] for r in rows if r.get(key)})


def fetch_filter_options() -> dict:
    """Return global morphology annotation filter options."""
    rows = _rma_query(
        "ApiCellTypesSpecimenDetail",
        criteria="[nr__reconstruction_type$nenull]",
        num_rows="all",
    )
    return {
        "dendrite_types":       _unique_sorted(rows, "tag__dendrite_type"),
        "apical":               _unique_sorted(rows, "tag__apical"),
        "reconstruction_types": _unique_sorted(rows, "nr__reconstruction_type"),
    }


def fetch_species_options(species: str) -> dict:
    """Return brain areas, layers, and transgenic lines for a species."""
    rows = _rma_query(
        "ApiCellTypesSpecimenDetail",
        criteria=f"[nr__reconstruction_type$nenull][donor__species$il'{species}']",
        num_rows="all",
    )

    brain_area_map: dict = {}
    layers:    set = set()
    line_names: set = set()

    for r in rows:
        acr        = (r.get("structure__acronym")        or "").strip().strip('"')
        name       = (r.get("structure__name")           or "").strip().strip('"')
        parent_acr = (r.get("structure_parent__acronym") or "").strip().strip('"')
        layer      = (r.get("structure__layer")          or "").strip()
        line       = (r.get("line_name")                 or "").strip()

        if name and "layer" in name.lower():
            parent_name = re.sub(r",?\s*layer\s+[\w/]+.*", "", name, flags=re.IGNORECASE).strip()
            use_acr   = parent_acr or acr
            use_name  = parent_name or name
            is_parent = bool(parent_acr)
            if use_acr and use_name:
                brain_area_map.setdefault(use_acr, {"name": use_name, "is_parent": is_parent})
        elif acr and name:
            brain_area_map[acr] = {"name": name, "is_parent": False}

        if layer:
            layers.add(layer)
        if line:
            line_names.add(line)

    return {
        "brain_areas": [
            {"acronym": acr, "name": entry["name"], "is_parent": entry["is_parent"]}
            for acr, entry in sorted(brain_area_map.items())
        ],
        "layers":     sorted(layers),
        "line_names": sorted(line_names),
    }


def search_neurons(
    species=None,
    sex=None,
    disease_state=None,
    brain_area_acronym=None,
    brain_area_parent_acronym=None,
    layer=None,
    hemisphere=None,
    dendrite_type=None,
    apical=None,
    reconstruction_type=None,
    reporter_status=None,
    line_name=None,
    page=0,
    size=20,
) -> dict:
    """Search for neurons with reconstructions. Returns {'neurons': [...], 'total': N}."""
    filters = ["[nr__reconstruction_type$nenull]"]

    if species:
        filters.append(f"[donor__species$il'{_safe_filter_value(species)}']")
    if sex:
        filters.append(f"[donor__sex$eq'{_safe_filter_value(sex)}']")
    if disease_state:
        filters.append(f"[donor__disease_state$il'{_safe_filter_value(disease_state)}']")
    if brain_area_acronym:
        filters.append(f"[structure__acronym$eq'{_safe_filter_value(brain_area_acronym)}']")
    if brain_area_parent_acronym:
        filters.append(f"[structure_parent__acronym$eq'{_safe_filter_value(brain_area_parent_acronym)}']")
    if layer:
        filters.append(f"[structure__layer$eq'{_safe_filter_value(layer)}']")
    if hemisphere:
        filters.append(f"[specimen__hemisphere$eq'{_safe_filter_value(hemisphere)}']")
    if dendrite_type:
        filters.append(f"[tag__dendrite_type$eq'{_safe_filter_value(dendrite_type)}']")
    if apical:
        filters.append(f"[tag__apical$eq'{_safe_filter_value(apical)}']")
    if reconstruction_type:
        filters.append(f"[nr__reconstruction_type$eq'{_safe_filter_value(reconstruction_type)}']")
    if reporter_status:
        filters.append(f"[cell_reporter_status$eq'{_safe_filter_value(reporter_status)}']")
    if line_name:
        filters.append(f"[line_name$il'{_safe_filter_value(line_name)}']")

    start_row = page * size
    rma = (
        f"model::ApiCellTypesSpecimenDetail,"
        f"rma::criteria,{''.join(filters)},"
        f"rma::options[num_rows$eq{size}][start_row$eq{start_row}][order$eq'specimen__id']"
    )
    resp = requests.get(_RMA_URL, params={"criteria": rma}, timeout=_QUERY_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"Allen RMA error: {data.get('msg', 'Unknown error')}")

    return {
        "neurons": data.get("msg", []),
        "total":   data.get("total_rows", 0),
    }


# ── SWC download ──────────────────────────────────────────────────────────────

def fetch_swc_for_specimen(specimen_id: int) -> tuple:
    """Download SWC morphology for a specimen. Returns (swc_text, filename)."""
    criteria = f"[id$eq{specimen_id}],neuron_reconstructions(well_known_files)"
    includes = (
        f"neuron_reconstructions("
        f"well_known_files(well_known_file_type[name$eq'{_SWC_FILE_TYPE}']))"
    )
    results = _rma_query("Specimen", criteria=criteria, include=includes)

    try:
        wkf      = results[0]["neuron_reconstructions"][0]["well_known_files"][0]
        file_url = wkf["download_link"]
    except (IndexError, KeyError, TypeError):
        raise RuntimeError(f"Specimen {specimen_id} has no reconstruction")

    server_name = file_url.rstrip("/").split("/")[-1]
    if not server_name.lower().endswith(".swc"):
        server_name = f"specimen_{specimen_id}.swc"

    resp = requests.get(_API_BASE + file_url, timeout=_DOWNLOAD_TIMEOUT)
    resp.raise_for_status()

    content_type = resp.headers.get("Content-Type", "")
    raw = resp.content

    if "zip" in content_type or raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            swc_names = [n for n in zf.namelist() if n.lower().endswith(".swc")]
            if not swc_names:
                raise RuntimeError(f"ZIP for specimen {specimen_id} contains no .swc file")
            raw         = zf.read(swc_names[0])
            server_name = swc_names[0].split("/")[-1]

    return raw.decode("utf-8"), server_name


# ── Image proxies ─────────────────────────────────────────────────────────────

def fetch_morph_thumb(file_id: int) -> tuple:
    """Proxy a morphology thumbnail. Returns (image_bytes, content_type)."""
    resp = requests.get(f"{_DOWNLOAD_URL}/{file_id}", timeout=_DOWNLOAD_TIMEOUT)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "image/png")


def _get_section_image_id(specimen_id: int) -> int:
    results = _rma_query("ProjectionImage", criteria=f"[specimen_id$eq{specimen_id}]")
    if not results:
        raise RuntimeError(f"No projection image found for specimen {specimen_id}")
    return results[0]["id"]


def fetch_section_image(specimen_id: int) -> tuple:
    """Proxy a section/projection JPEG. Returns (image_bytes, content_type)."""
    image_id = _get_section_image_id(specimen_id)
    resp = requests.get(
        f"{_API_BASE}/api/v2/section_image_download/{image_id}",
        timeout=_DOWNLOAD_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "image/jpeg")


def fetch_section_svg(specimen_id: int) -> tuple:
    """Proxy a vector SVG of the section image. Returns (svg_bytes, 'image/svg+xml')."""
    image_id = _get_section_image_id(specimen_id)
    resp = requests.get(
        f"{_API_BASE}/api/v2/svg_download/{image_id}",
        timeout=_DOWNLOAD_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.content, "image/svg+xml"
