import eventlet
eventlet.monkey_patch()
import os
import sys
import subprocess
import json
import uuid
import time
import threading
import shutil
import re
from flask import Flask, request, jsonify, send_from_directory, send_file, after_this_request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room
from werkzeug.utils import secure_filename

# --- Configuration ---
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
USER_UPLOADS_DIR = os.path.join(BASE_DIR, 'user_uploads')

os.makedirs(USER_UPLOADS_DIR, exist_ok=True)

# --- Flask App Initialization ---
app = Flask(__name__)
CORS(app)

# Quiet logging
socketio = SocketIO(app, cors_allowed_origins="*", logger=False, engineio_logger=False)

from neuromorpho.neuromorpho_routes import neuromorpho_routes
app.register_blueprint(neuromorpho_routes, url_prefix="/neuromorpho")

from allenbrain.allenbrain_routes import allenbrain_routes
app.register_blueprint(allenbrain_routes, url_prefix="/allenbrain")

# --- Store running process and session info ---
running_processes = {}
client_sim_map = {}
sid_clientid_map = {}

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
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400
    if file:
        filename = secure_filename(file.filename)
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
    if pid in running_processes:
        process = running_processes[pid]["process"]
        if process.poll() is None:
            try:
                command_payload = {"command": command, "params": data.get("params", {})}
                command_string = json.dumps(command_payload) + '\n'
                process.stdin.write(command_string)
                process.stdin.flush()
            except Exception as e:
                print(f"Error writing to PID {pid} stdin: {e}")


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

    if not data_channel_id:
        data_channel_id = str(uuid.uuid4())
    
    if client_id in client_sim_map:
        old_pid = client_sim_map[client_id]
        terminate_process(old_pid)
        client_sim_map.pop(client_id, None)

    session_dir = os.path.join(USER_UPLOADS_DIR, client_id)
    os.makedirs(session_dir, exist_ok=True)

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
    if '..' in client_id or '/' in client_id or '\\' in client_id:
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

    return send_file(archive_path, as_attachment=True, download_name="project.zip")

@app.route('/internal/push_data', methods=['POST'])
def push_data():
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
    if client_id:
        sid_clientid_map[request.sid] = client_id
        print(f"Registered client {client_id} to SID {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    client_id = sid_clientid_map.get(request.sid)
    if client_id:
        session_dir = os.path.join(USER_UPLOADS_DIR, client_id)
        if os.path.exists(session_dir):
            try:
                shutil.rmtree(session_dir)
            except Exception as e:
                print(f"Error deleting session directory {session_dir}: {e}")
        
        sid_clientid_map.pop(request.sid, None)
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
    if '..' in client_id or '/' in client_id or '..' in filename or filename.startswith('/'):
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
    try:
        pid_to_reset = int(pid_to_reset_str)
    except (ValueError, TypeError):
        return jsonify({"status": "error", "message": f"Invalid PID format: {pid_to_reset_str}"}), 400

    if terminate_process(pid_to_reset):
        if client_id and client_id in client_sim_map:
            client_sim_map.pop(client_id, None)
        return jsonify({"status": "success", "message": f"Simulation PID {pid_to_reset} reset."}), 200
    else:
        return jsonify({"status": "error", "message": "Process ID not found for reset."}), 404

if __name__ == '__main__':
    #print(f"User Uploads Directory (absolute): {os.path.abspath(USER_UPLOADS_DIR)}")
    #print("Starting Flask-SocketIO server...")
    socketio.run(app, host='0.0.0.0', debug=False, port=5000)
