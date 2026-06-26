from gevent import monkey
monkey.patch_all()

import os
import sys
import subprocess
import json
import uuid
import time
import threading
import shutil
import zipfile
import re
import secrets
from flask import Flask, request, jsonify, send_from_directory, send_file, after_this_request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room, emit as sock_emit
from werkzeug.utils import secure_filename

# --- Configuration ---
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
USER_UPLOADS_DIR = os.path.join(BASE_DIR, 'user_uploads')

# Secret shared with simulation subprocesses; never exposed to clients.
_INTERNAL_SECRET = secrets.token_hex(32)
_LOOPBACK = {'127.0.0.1', '::1', '::ffff:127.0.0.1'}

os.makedirs(USER_UPLOADS_DIR, exist_ok=True)

# --- Flask App Initialization ---
app = Flask(__name__)
CORS(app)

# Quiet logging
socketio = SocketIO(app, cors_allowed_origins="*", logger=False, engineio_logger=False, async_mode='gevent')

from neuromorpho.neuromorpho_routes import neuromorpho_routes, stage_neuron as _nm_stage
from neuromorpho.neuromorpho import search_neurons, fetch_neuron_by_id as _nm_fetch_by_id, neuron_to_item as _nm_to_item
app.register_blueprint(neuromorpho_routes, url_prefix="/neuromorpho")

from allenbrain.allenbrain_routes import allenbrain_routes, stage_specimen as _ab_stage
from allenbrain.allenbrain import fetch_specimen_by_id as _ab_fetch_by_id, specimen_to_details as _ab_to_details
app.register_blueprint(allenbrain_routes, url_prefix="/allenbrain")

# --- Store running process and session info ---
running_processes = {}
client_sim_map = {}
sid_clientid_map = {}   # sid → client_id
client_owner_map = {}   # client_id → (sid, session_token)

def stream_printer(stream, pid, stream_name, emit_error_fn=None):
    """
    Reads a stream line-by-line.
    1. Prints to console for debugging.
    2. Parses JSON lines to relay specific events (errors) to the frontend.
    3. Scans plain text for "Error:" to catch C++ backend errors.
    """
    try:
        for line in iter(stream.readline, ''):
            if line:
                stripped_line = line.strip()
                # DEBUG: Raw output
                print(f"[{pid}-{stream_name}] {stripped_line}")
                
                if emit_error_fn:
                    # Case 1: JSON formatted errors (from Python exception handler)
                    if stripped_line.startswith('{'):
                        try:
                            data = json.loads(stripped_line)
                            msg_type = data.get("type")
                            
                            if msg_type in ["sim_error", "error", "simulation_error"]:
                                #print(f"DEBUG: Triggering emit_error_fn for type '{msg_type}'")
                                emit_error_fn(data)
                        except json.JSONDecodeError:
                            pass
                    
                    # Case 2: Plain text errors (from C++/MOOSE stdout)
                    # Catches "Error:" or "Err:" patterns often used by MOOSE
                    elif "Error:" in stripped_line or "Err:" in stripped_line:
                        print(f"DEBUG: Detected plain text error in {stream_name}, probably MOOSE error")
                        error_payload = {
                            "type": "sim_error",
                            "message": "Simulation Engine Error",
                            "details": stripped_line
                        }
                        emit_error_fn(error_payload)
                        
        stream.close()
        #print(f"Stream printer for PID {pid} ({stream_name}) has finished.")
    except Exception as e:
        print(f"Error in stream printer for PID {pid} ({stream_name}): {e}")


def terminate_process(pid):
    """Safely terminates a running process and cleans up its entry."""
    if pid in running_processes:
        try:
            proc_info = running_processes[pid]
            if proc_info["process"].poll() is None:
                print(f"Terminating process {pid}...")
                proc_info["process"].terminate()
                proc_info["process"].wait(timeout=5)
                print(f"Process {pid} terminated.")
            del running_processes[pid]
            return True
        except Exception as e:
            print(f"Error during termination of PID {pid}: {e}")
            if pid in running_processes:
                del running_processes[pid]
    return False

_UPLOADS_REAL = os.path.realpath(USER_UPLOADS_DIR)

# Extensions accepted for user-uploaded model files.
_ALLOWED_UPLOAD_EXTENSIONS = {'.swc', '.p', '.g', '.xml', '.sbml', '.nml', '.json'}

def _is_safe_client_id(client_id):
    """Return True only if client_id resolves to a path within USER_UPLOADS_DIR."""
    if not isinstance(client_id, str) or not client_id:
        return False
    if '..' in client_id or '/' in client_id or '\\' in client_id:
        return False
    resolved = os.path.realpath(os.path.join(USER_UPLOADS_DIR, client_id))
    return resolved.startswith(_UPLOADS_REAL + os.sep)

def _validate_config_sources(config_data):
    """Return a list of violation strings; empty means the config is safe."""
    violations = []
    def _check(section, src):
        if isinstance(src, str) and (
            src.startswith('/') or '..' in src or '/' in src or '\\' in src
        ):
            violations.append(f"{section}.source={src!r}")

    for section in ('spineProto', 'chanProto', 'chemProto'):
        for item in config_data.get(section, []):
            if isinstance(item, dict) and item.get('type') in ('func', 'builtin'):
                _check(section, item.get('source', ''))

    cp = config_data.get('cellProto')
    if isinstance(cp, dict) and cp.get('type') == 'func':
        _check('cellProto', cp.get('source', ''))

    return violations

def get_next_model_filename(directory):
    pattern = re.compile(r'^jardes_model_(\d+)\.json$')
    max_n = 0
    if os.path.exists(directory):
        for filename in os.listdir(directory):
            match = pattern.match(filename)
            if match:
                try:
                    n = int(match.group(1))
                    if n > max_n: max_n = n
                except ValueError: continue
    return f"jardes_model_{max_n + 1}.json"

# --- API Endpoints ---
@app.route('/')
def index():
    return jsonify({"message": "Flask backend is running!"})

@app.route('/upload_file', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part in the request"}), 400
    file = request.files['file']
    client_id = request.form.get('clientId')
    if not client_id:
        return jsonify({"status": "error", "message": "No clientId provided"}), 400
    if not _is_safe_client_id(client_id):
        return jsonify({"status": "error", "message": "Invalid client ID"}), 400
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400
    if file:
        filename = secure_filename(file.filename)
        ext = os.path.splitext(filename)[1].lower()
        if ext not in _ALLOWED_UPLOAD_EXTENSIONS:
            return jsonify({
                "status": "error",
                "message": f"File type '{ext}' is not allowed. Permitted: {', '.join(sorted(_ALLOWED_UPLOAD_EXTENSIONS))}"
            }), 400
        session_dir = os.path.join(USER_UPLOADS_DIR, client_id)
        os.makedirs(session_dir, exist_ok=True)
        save_path = os.path.join(session_dir, filename)
        file.save(save_path)
        print(f"Saved file for client {client_id} to {save_path}")
        return jsonify({"status": "success", "filename": filename, "message": "File uploaded successfully"}), 200
    return jsonify({"status": "error", "message": "File upload failed for unknown reasons"}), 500

@socketio.on('sim_command')
def handle_sim_command(data):
    pid_str = data.get('pid')
    command = data.get('command')
    if not pid_str or not command: return
    try:
        pid = int(pid_str)
    except (ValueError, TypeError): return
    caller_client_id = sid_clientid_map.get(request.sid)
    if not caller_client_id:
        return
    if pid in running_processes:
        if running_processes[pid].get("client_id") != caller_client_id:
            return
        process = running_processes[pid]["process"]
        if process.poll() is None:
            try:
                command_payload = {"command": command, "params": data.get("params", {})}
                command_string = json.dumps(command_payload) + '\n'
                process.stdin.write(command_string)
                process.stdin.flush()
            except Exception as e:
                print(f"Error writing to PID {pid} stdin: {e}")


# --- Proto Registry Endpoints ---

PROTO_REGISTRY_DIR = os.path.join(BASE_DIR, 'proto_registry')
_ALLOWED_STAGING_DIRS = {'CELL_MODELS', 'CHEM_MODELS', 'CHAN_MODELS'}


_NM_ITEM_CACHE = os.path.join(BASE_DIR, 'data', 'neuromorpho', 'item_cache.json')

def _nm_cache_load():
    if os.path.exists(_NM_ITEM_CACHE):
        try:
            return json.loads(open(_NM_ITEM_CACHE).read())
        except Exception:
            return {}
    return {}

def _nm_cache_save(cache):
    os.makedirs(os.path.dirname(_NM_ITEM_CACHE), exist_ok=True)
    with open(_NM_ITEM_CACHE, 'w') as f:
        json.dump(cache, f, indent=2)


def _load_registry(proto_type):
    path = os.path.join(PROTO_REGISTRY_DIR, f'{proto_type}_protos.json')
    if not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        return json.load(f)

@app.route('/proto_digest/<proto_type>', methods=['GET'])
def get_proto_digest(proto_type):
    if proto_type not in ('morpho', 'chan', 'chem'):
        return jsonify({'error': 'Invalid type'}), 400
    data = _load_registry(proto_type)
    if data is None:
        return jsonify({'items': []})
    return jsonify(data)

@app.route('/proto_detail/<proto_id>', methods=['GET'])
def get_proto_detail(proto_id):
    if proto_id.startswith('nm_'):
        try:
            neuron = _nm_fetch_by_id(int(proto_id[3:]))
            return jsonify(_nm_to_item(neuron)['details'])
        except Exception:
            return jsonify({})

    if proto_id.startswith('ab_'):
        try:
            specimen = _ab_fetch_by_id(int(proto_id[3:]))
            return jsonify(_ab_to_details(specimen))
        except Exception:
            return jsonify({})

    for proto_type in ('morpho', 'chan', 'chem'):
        data = _load_registry(proto_type)
        if data:
            for item in data.get('items', []):
                if item.get('id') == proto_id:
                    return jsonify(item.get('details', {}))
    return jsonify({'error': 'Not found'}), 404

@app.route('/proto_search/<proto_type>', methods=['GET'])
def search_protos(proto_type):
    if proto_type not in ('morpho', 'chan', 'chem'):
        return jsonify({'error': 'Invalid type'}), 400
    q  = request.args.get('q', '').lower().strip()
    db = request.args.get('db', 'Local')

    if db == 'NeuroMorpho' and proto_type == 'morpho':
        try:
            raw = search_neurons(neuron_name=q if q else None, size=50)
            neurons = raw.get('_embedded', {}).get('neuronResources', [])
            return jsonify({'items': [_nm_to_item(n) for n in neurons]})
        except Exception as e:
            return jsonify({'error': str(e), 'items': []}), 500

    data = _load_registry(proto_type)
    if data is None:
        return jsonify({'items': []})
    if not q:
        return jsonify(data)
    filtered = [
        item for item in data.get('items', [])
        if q in item.get('name', '').lower()
        or q in item.get('description', '').lower()
        or q in item.get('source', '').lower()
    ]
    return jsonify({'items': filtered})

@app.route('/proto_stage/<proto_id>/<client_id>', methods=['POST'])
def stage_proto_file(proto_id, client_id):
    """Copy a server-side proto file into the user's uploads directory."""
    if not _is_safe_client_id(client_id):
        return jsonify({'error': 'Invalid client_id'}), 400

    if proto_id.startswith('nm_'):
        try:
            return jsonify(_nm_stage(int(proto_id[3:]), client_id))
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    if proto_id.startswith('ab_'):
        try:
            return jsonify(_ab_stage(int(proto_id[3:]), client_id))
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    for proto_type in ('morpho', 'chan', 'chem'):
        data = _load_registry(proto_type)
        if data:
            for item in data.get('items', []):
                if item.get('id') == proto_id:
                    server_file = item.get('server_file', '')
                    if not server_file:
                        return jsonify({'error': 'No server file for this proto'}), 400
                    # Security: only allow files from known safe subdirectories.
                    parts = server_file.replace('\\', '/').split('/')
                    if len(parts) < 2 or parts[0] not in _ALLOWED_STAGING_DIRS or '..' in parts:
                        return jsonify({'error': 'Invalid server file path'}), 400
                    src = os.path.join(BASE_DIR, server_file)
                    if not os.path.exists(src):
                        return jsonify({'error': 'File not found on server'}), 404
                    dest_dir = os.path.join(USER_UPLOADS_DIR, client_id)
                    os.makedirs(dest_dir, exist_ok=True)
                    filename = os.path.basename(src)
                    dest = os.path.join(dest_dir, filename)
                    shutil.copy2(src, dest)
                    return jsonify({'filename': filename})
    return jsonify({'error': 'Proto not found'}), 404


@app.route('/launch_simulation', methods=['POST'])
def launch_simulation():
    request_data = request.json
    config_data = request_data.get('config_data')
    client_id = request_data.get('client_id')
    
    data_channel_id = request_data.get('data_channel_id')

    if not config_data or not isinstance(config_data, dict):
        return jsonify({"status": "error", "message": "Invalid or missing JSON config data"}), 400
    if not client_id:
        return jsonify({"status": "error", "message": "Request is missing client_id"}), 400
    if not _is_safe_client_id(client_id):
        return jsonify({"status": "error", "message": "Invalid client ID"}), 400

    violations = _validate_config_sources(config_data)
    if violations:
        return jsonify({
            "status": "error",
            "message": "Config rejected: source paths must be simple function names, not file paths.",
            "details": violations
        }), 400

    if not data_channel_id:
        data_channel_id = str(uuid.uuid4())
    
    if client_id in client_sim_map:
        old_pid = client_sim_map[client_id]
        terminate_process(old_pid)
        client_sim_map.pop(client_id, None)

    session_dir = os.path.join(USER_UPLOADS_DIR, client_id)
    os.makedirs(session_dir, exist_ok=True)

    # Check for missing external files before launching (skip if frontend already warned the user)
    if not request_data.get('skip_missing_files_check'):
        missing = []
        cell = config_data.get('cellProto', {})
        if isinstance(cell, dict) and cell.get('type') == 'file' and cell.get('source'):
            if not os.path.isfile(os.path.join(session_dir, os.path.basename(cell['source']))):
                missing.append(cell['source'])
        for cp in config_data.get('chemProto', []):
            if cp.get('type') in ('sbml', 'SBML', 'kkit') and cp.get('source'):
                if not os.path.isfile(os.path.join(session_dir, os.path.basename(cp['source']))):
                    missing.append(cp['source'])
        for cp in config_data.get('chanProto', []):
            if cp.get('type') == 'neuroml' and cp.get('source'):
                if not os.path.isfile(os.path.join(session_dir, os.path.basename(cp['source']))):
                    missing.append(cp['source'])
        if missing:
            return jsonify({
                "status": "error",
                "message": f"Cannot run: required file(s) not uploaded: {', '.join(missing)}. Load them via Browse Library before running."
            }), 400

    model_filename = get_next_model_filename(session_dir)
    config_file_path = os.path.join(session_dir, model_filename)

    try:
        with open(config_file_path, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, indent=2)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Could not save config file: {e}"}), 500
    
    plot_filename = "plot.json"
    plot_filepath = os.path.abspath(os.path.join(session_dir, plot_filename))
    
    current_dir = os.path.dirname(os.path.abspath(__file__))
    launcher_path = os.path.normpath(os.path.join(current_dir, '..', 'launch_jardes.py'))

    worker_args = [
        config_file_path,
        "--plotFile", plot_filepath, 
        "--data-channel-id", data_channel_id,
        "--session-path", session_dir
    ]
    
    try:
        env = os.environ.copy()
        if 'PYTHONPATH' in env:
            env['PYTHONPATH'] = f"{BASE_DIR}:{env['PYTHONPATH']}"
        else:
            env['PYTHONPATH'] = BASE_DIR
        env['JARDESIGNER_INTERNAL_TOKEN'] = _INTERNAL_SECRET
        
        #print(f"DEBUG: Launching subprocess for client {client_id} with channel {data_channel_id}")
        
        process = subprocess.Popen(
            [sys.executable, launcher_path] + worker_args,
            cwd=BASE_DIR, 
            stdin=subprocess.PIPE, 
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, 
            text=True, 
            bufsize=1, 
            env=env
        )

        running_processes[process.pid] = {
            "process": process, "plot_filename": plot_filename,
            "config_file_path": config_file_path, "start_time": time.time(),
            "data_channel_id": data_channel_id, "client_id": client_id,
        }
        client_sim_map[client_id] = process.pid

        # Callback to emit error to the specific client room
        def emit_error(error_data):
            msg = error_data.get('message', 'Unknown Error')
            print(f"DEBUG: Attempting to emit 'simulation_error' to room '{data_channel_id}'")
            print(f"DEBUG: Error Payload: {msg}")
            socketio.emit('simulation_error', error_data, room=data_channel_id)

        socketio.start_background_task(target=stream_printer, stream=process.stdout, pid=process.pid, stream_name='stdout', emit_error_fn=emit_error)
        socketio.start_background_task(target=stream_printer, stream=process.stderr, pid=process.pid, stream_name='stderr', emit_error_fn=emit_error)

    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to launch MOOSE script: {e}"}), 500

    return jsonify({
        "status": "success", "pid": process.pid,
        "plot_filename": plot_filename, "data_channel_id": data_channel_id
    }), 200

@app.route('/download_project/<client_id>', methods=['GET'])
def download_project(client_id):
    if not _is_safe_client_id(client_id):
        return jsonify({"status": "error", "message": "Invalid Client ID"}), 400

    session_dir = os.path.join(USER_UPLOADS_DIR, client_id)
    if not os.path.exists(session_dir):
        return jsonify({"status": "error", "message": "Project directory not found"}), 404
    
    timestamp = str(uuid.uuid4())
    zip_base_name = os.path.join(USER_UPLOADS_DIR, f"project_{timestamp}")
    
    try:
        archive_path = shutil.make_archive(zip_base_name, 'zip', session_dir)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to zip project: {str(e)}"}), 500

    @after_this_request
    def remove_file(response):
        try:
            if os.path.exists(archive_path):
                os.remove(archive_path)
                print(f"Deleted temp zip: {archive_path}")
        except Exception as e:
            print(f"Error removing temp zip: {e}")
        return response

    return send_file(archive_path, as_attachment=True, download_name="project.jardes")


def _get_newest_jardesigner_json(session_dir):
    """Return (path, parsed_dict) of the newest jardesigner JSON, or (None, None).
    Sorts by trailing numeric index in the filename (highest wins), then mtime as tiebreaker.
    This is reliable even after ZIP extraction where all mtimes become identical."""
    candidates = []
    for fname in os.listdir(session_dir):
        if not fname.endswith('.json'):
            continue
        fpath = os.path.join(session_dir, fname)
        try:
            with open(fpath, 'r') as f:
                parsed = json.load(f)
            if parsed.get('filetype') == 'jardesigner':
                m = re.search(r'(\d+)\.json$', fname)
                index = int(m.group(1)) if m else -1
                candidates.append((index, os.path.getmtime(fpath), fpath, parsed))
        except Exception:
            continue
    if not candidates:
        return None, None
    candidates.sort(reverse=True)
    return candidates[0][2], candidates[0][3]


def _get_referenced_sources(parsed):
    """Return list of source filenames referenced by a jardesigner model dict."""
    sources = []
    cell = parsed.get('cellProto', {})
    if cell.get('type') == 'file' and cell.get('source'):
        sources.append(cell['source'])
    for cp in parsed.get('chemProto', []):
        if cp.get('source'):
            sources.append(cp['source'])
    for cp in parsed.get('chanProto', []):
        if cp.get('source'):
            sources.append(cp['source'])
    return sources


@app.route('/download_project_smart/<client_id>', methods=['GET'])
def download_project_smart(client_id):
    """Download a minimal .jardes archive: newest JSON (renamed to basename) + referenced files only."""
    if not _is_safe_client_id(client_id):
        return jsonify({"status": "error", "message": "Invalid Client ID"}), 400

    basename = request.args.get('basename', 'model')
    # Sanitise: strip path separators and keep only safe characters
    basename = re.sub(r'[^\w\-. ]', '_', os.path.basename(basename))
    if not basename:
        basename = 'model'

    session_dir = os.path.join(USER_UPLOADS_DIR, client_id)
    if not os.path.exists(session_dir):
        return jsonify({"status": "error", "message": "Project directory not found"}), 404

    json_path, parsed = _get_newest_jardesigner_json(session_dir)
    if json_path is None:
        return jsonify({"status": "error", "message": "No model JSON found in session"}), 404

    sources = _get_referenced_sources(parsed)

    tmp_zip_path = os.path.join(USER_UPLOADS_DIR, f'_smart_{uuid.uuid4()}.zip')
    try:
        with zipfile.ZipFile(tmp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.write(json_path, arcname=f'{basename}.json')
            for src in sources:
                src_path = os.path.join(session_dir, os.path.basename(src))
                if os.path.isfile(src_path):
                    zf.write(src_path, arcname=os.path.basename(src))
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to build archive: {str(e)}"}), 500

    @after_this_request
    def remove_file(response):
        try:
            if os.path.exists(tmp_zip_path):
                os.remove(tmp_zip_path)
        except Exception as ex:
            print(f"Error removing temp zip: {ex}")
        return response

    return send_file(tmp_zip_path, as_attachment=True, download_name=f'{basename}.jardes')


@app.route('/upload_project/<client_id>', methods=['POST'])
def upload_project(client_id):
    if not _is_safe_client_id(client_id):
        return jsonify({'error': 'Invalid client ID'}), 400
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename.lower().endswith('.jardes'):
        return jsonify({'error': 'Expected a .jardes file'}), 400

    session_dir = os.path.join(USER_UPLOADS_DIR, client_id)
    os.makedirs(session_dir, exist_ok=True)

    archive_path = os.path.join(session_dir, '_project_upload' + os.path.splitext(secure_filename(file.filename))[1])
    file.save(archive_path)

    try:
        shutil.unpack_archive(archive_path, session_dir, format='zip')
    except Exception as e:
        return jsonify({'error': f'Failed to unpack archive: {str(e)}'}), 400
    finally:
        os.remove(archive_path)

    # Prefer <basename>.json (matches the .jardes filename), then fall back to newest by mtime
    upload_basename = os.path.splitext(secure_filename(file.filename))[0]
    preferred_name = upload_basename + '.json'
    preferred_path = os.path.join(session_dir, preferred_name)

    json_content = None
    if os.path.isfile(preferred_path):
        try:
            with open(preferred_path, 'r') as f:
                text = f.read()
            if json.loads(text).get('filetype') == 'jardesigner':
                json_content = text
        except Exception:
            pass

    if json_content is None:
        json_path, _ = _get_newest_jardesigner_json(session_dir)
        if json_path:
            with open(json_path, 'r') as f:
                json_content = f.read()

    if json_content is None:
        return jsonify({'error': 'No jardesigner JSON file found in archive'}), 400

    return jsonify({'status': 'success', 'json': json_content})

@app.route('/internal/push_data', methods=['POST'])
def push_data():
    if request.remote_addr not in _LOOPBACK:
        return jsonify({"status": "error", "message": "Forbidden"}), 403
    if not secrets.compare_digest(
        request.headers.get('X-Internal-Token', ''), _INTERNAL_SECRET
    ):
        return jsonify({"status": "error", "message": "Forbidden"}), 403
    data = request.json
    channel_id = data.get('data_channel_id')
    payload = data.get('payload')
    if not channel_id or payload is None:
        return jsonify({"status": "error", "message": "Missing data_channel_id or payload"}), 400

    # Send data without printing (quiet mode)
    socketio.emit('simulation_data', payload, room=channel_id)
    return jsonify({"status": "success"}), 200

@socketio.on('connect')
def handle_connect():
    headers = dict(request.headers)
    upgrade = headers.get("Upgrade", "Not found").lower()
    if "websocket" not in upgrade:
        print("SERVER LOG: >>> FATAL: 'Upgrade: websocket' header is MISSING.")

@socketio.on('register_client')
def handle_register_client(data):
    client_id = data.get('clientId')
    if not client_id or not _is_safe_client_id(client_id):
        return
    existing = client_owner_map.get(client_id)
    if existing:
        # client_id already claimed — require the correct token to take over
        _, stored_token = existing
        provided = data.get('sessionToken', '')
        if not secrets.compare_digest(provided, stored_token):
            return  # reject: spoofing attempt or stale reconnect without token
    session_token = secrets.token_hex(16)
    sid_clientid_map[request.sid] = client_id
    client_owner_map[client_id] = (request.sid, session_token)
    sock_emit('session_token', {'token': session_token})
    print(f"Registered client {client_id} to SID {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    client_id = sid_clientid_map.pop(request.sid, None)
    if client_id:
        owner_sid, _ = client_owner_map.get(client_id, (None, None))
        if owner_sid == request.sid:
            # This socket is still the registered owner — safe to clean up.
            client_owner_map.pop(client_id, None)
            session_dir = os.path.join(USER_UPLOADS_DIR, client_id)
            if os.path.exists(session_dir):
                try:
                    shutil.rmtree(session_dir)
                except Exception as e:
                    print(f"Error deleting session directory {session_dir}: {e}")
        pid = client_sim_map.pop(client_id, None)
        if pid:
            terminate_process(pid)

@socketio.on('join_sim_channel')
def handle_join_sim_channel(data):
    channel_id = data.get('data_channel_id')
    if not channel_id: return
    join_room(channel_id)
    print(f"DEBUG: Client {request.sid} JOINED channel: {channel_id}")

@app.route('/simulation_status/<int:pid>', methods=['GET'])
def simulation_status(pid):
    if pid not in running_processes:
        return jsonify({"status": "error", "message": "Process ID not found."}), 404
    
    proc_info = running_processes[pid]
    process = proc_info["process"]
    plot_filename = proc_info["plot_filename"]
    client_id = proc_info["client_id"]
    session_dir = os.path.join(USER_UPLOADS_DIR, client_id)
    plot_filepath = os.path.abspath(os.path.join(session_dir, plot_filename))

    poll_result = process.poll()
    if poll_result is None:
        return jsonify({"status": "running", "pid": pid, "message": "Simulation is still in progress."}), 200
    else:
        plot_exists = os.path.exists(plot_filepath)
        if plot_exists:
            return jsonify({"status": "completed", "pid": pid, "plot_filename": plot_filename, "plot_ready": True}), 200
        else:
            return jsonify({"status": "completed_error", "pid": pid, "message": "Plot not found."}), 200

@app.route('/session_file/<client_id>/<filename>')
def get_session_file(client_id, filename):
    if not _is_safe_client_id(client_id) or '..' in filename or filename.startswith('/'):
        return jsonify({"status": "error", "message": "Invalid path."}), 400
    session_dir = os.path.join(USER_UPLOADS_DIR, client_id)
    return send_from_directory(session_dir, filename)

@app.route('/reset_simulation', methods=['POST'])
def reset_simulation():
    request_data = request.json
    pid_to_reset_str = request_data.get('pid')
    client_id = request_data.get('client_id')
    if not pid_to_reset_str:
        return jsonify({"status": "error", "message": "PID not provided for reset."}), 400
    if not _is_safe_client_id(client_id):
        return jsonify({"status": "error", "message": "Invalid client ID."}), 400
    try:
        pid_to_reset = int(pid_to_reset_str)
    except (ValueError, TypeError):
        return jsonify({"status": "error", "message": f"Invalid PID format: {pid_to_reset_str}"}), 400

    proc_info = running_processes.get(pid_to_reset)
    if proc_info and proc_info.get("client_id") != client_id:
        return jsonify({"status": "error", "message": "Process ID not found for reset."}), 404

    if terminate_process(pid_to_reset):
        client_sim_map.pop(client_id, None)
        return jsonify({"status": "success", "message": f"Simulation PID {pid_to_reset} reset."}), 200
    else:
        return jsonify({"status": "error", "message": "Process ID not found for reset."}), 404

if __name__ == '__main__':
    #print(f"User Uploads Directory (absolute): {os.path.abspath(USER_UPLOADS_DIR)}")
    #print("Starting Flask-SocketIO server...")
    socketio.run(app, host='0.0.0.0', debug=False, port=5000)
