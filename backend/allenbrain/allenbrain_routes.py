##############################################
# allenbrain_routes.py — Flask routes for Allen Brain Cell Types Database
# CORS handled globally in server.py.
##############################################
import traceback

from flask import Blueprint, jsonify, request

from .allenbrain import (
    fetch_filter_options,
    fetch_species_options,
    search_neurons,
    fetch_swc_for_specimen,
    fetch_morph_thumb,
    fetch_section_image,
    fetch_section_svg,
)

allenbrain_routes = Blueprint("allenbrain", __name__)


@allenbrain_routes.route("/filters", methods=["GET"])
def get_filters():
    """GET /allenbrain/filters — global options: species + morphology annotation fields."""
    try:
        return jsonify(fetch_filter_options())
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@allenbrain_routes.route("/metadata", methods=["GET"])
def get_species_filters():
    """
    GET /allenbrain/metadata?species=<name>
    Returns brain areas, layers, and transgenic lines for the given species.
    """
    species = request.args.get("species", "").strip()
    if not species:
        return jsonify({"error": "species query param required"}), 400
    try:
        return jsonify(fetch_species_options(species))
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@allenbrain_routes.route("/search", methods=["POST"])
def search():
    """
    POST /allenbrain/search
    Body: { species?, sex?, disease_state?, brain_area_acronym?,
            brain_area_parent_acronym?, layer?, hemisphere?,
            dendrite_type?, apical?, reconstruction_type?,
            reporter_status?, line_name?, page?, size? }
    """
    body = request.get_json(force=True, silent=True) or {}
    try:
        size = max(1, int(body.get("size", 20)))
        page = max(0, int(body.get("page", 0)))
    except (TypeError, ValueError):
        return jsonify({"error": "page and size must be integers"}), 400

    try:
        result = search_neurons(
            species                   = body.get("species") or None,
            sex                       = body.get("sex") or None,
            disease_state             = body.get("disease_state") or None,
            brain_area_acronym        = body.get("brain_area_acronym") or None,
            brain_area_parent_acronym = body.get("brain_area_parent_acronym") or None,
            layer                     = body.get("layer") or None,
            hemisphere                = body.get("hemisphere") or None,
            dendrite_type             = body.get("dendrite_type") or None,
            apical                    = body.get("apical") or None,
            reconstruction_type       = body.get("reconstruction_type") or None,
            reporter_status           = body.get("reporter_status") or None,
            line_name                 = body.get("line_name") or None,
            page                      = page,
            size                      = size,
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

    total       = result["total"]
    total_pages = max(1, -(-total // size))

    return jsonify({
        "neurons":     result["neurons"],
        "total":       total,
        "page":        page,
        "total_pages": total_pages,
    })


@allenbrain_routes.route("/swc/<int:specimen_id>", methods=["GET"])
def get_swc(specimen_id: int):
    """GET /allenbrain/swc/<specimen_id> — proxy SWC morphology download."""
    try:
        swc_text, filename = fetch_swc_for_specimen(specimen_id)
        return swc_text, 200, {
            "Content-Type": "text/plain",
            "Content-Disposition": f'attachment; filename="{filename}"',
        }
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@allenbrain_routes.route("/thumb/<int:file_id>", methods=["GET"])
def get_thumb(file_id: int):
    """
    GET /allenbrain/thumb/<file_id>
    Proxies the morphology thumbnail from morph_thumb_path (well_known_file_download).
    """
    try:
        img_bytes, content_type = fetch_morph_thumb(file_id)
        return img_bytes, 200, {"Content-Type": content_type}
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@allenbrain_routes.route("/preview/<int:specimen_id>", methods=["GET"])
def get_preview(specimen_id: int):
    """
    GET /allenbrain/preview/<specimen_id>
    Proxies a section/projection JPEG via section_image_download API.
    """
    try:
        img_bytes, content_type = fetch_section_image(specimen_id)
        return img_bytes, 200, {"Content-Type": content_type}
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 404


@allenbrain_routes.route("/svg/<int:specimen_id>", methods=["GET"])
def get_svg(specimen_id: int):
    """
    GET /allenbrain/svg/<specimen_id>
    Proxies a vector SVG of the section image via svg_download API.
    Higher quality than /preview (vector, scalable).
    """
    try:
        svg_bytes, content_type = fetch_section_svg(specimen_id)
        return svg_bytes, 200, {"Content-Type": content_type}
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 404


@allenbrain_routes.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})
