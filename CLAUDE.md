# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jardesigner is a browser-based GUI for building and simulating multiscale neuronal models using [MOOSE](https://moose.ncbs.res.in/) (Messaging Object Oriented Simulation Environment) and rdesigneur. It enables researchers to design reaction-diffusion and electrical signaling models in neurons without writing code.

## Development Commands

### Frontend (React + Vite)
```bash
cd frontend
npm install          # Install dependencies
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Production build → frontend/dist/
npm run build:standalone  # Single self-contained HTML file
```

### Backend (Flask + Socket.IO)
```bash
cd backend
python server.py     # Start backend on http://0.0.0.0:5000
```

### Running a simulation directly
```bash
python launch_jardes.py <config.json>
```

No test framework is configured for either frontend or backend.

## Architecture

The application has three distinct layers that communicate via HTTP REST and WebSocket (Socket.IO):

```
Browser (React) ←─ HTTP + WebSocket ─→ Flask (server.py) ←─ subprocess ─→ MOOSE (jardesigner.py)
```

### Frontend (`frontend/src/`)

- **`appLogic.js`** — Central state hook (`useAppLogic`). Owns the `jsonData` model config object and all mutations to it. Manages Socket.IO client and REST calls to the backend.
- **`AppLayout.jsx`** — Main layout. Renders the menu system and coordinates which MenuBox is visible.
- **`components/MenuBoxes/`** — One component per model aspect: `FileMenuBox`, `MorphoMenuBox`, `SpineMenuBox`, `ElecMenuBox`, `PassiveMenuBox`, `ChemMenuBox`, `AdaptorsMenuBox`, `PlotMenuBox`, `StimMenuBox`, `RunMenuBox`, `ThreeDMenuBox`, `SimOutputMenuBox`.
- **`components/ThreeDViewer.jsx`** + **`utils/threeDUtils.js`** — Three.js 3D visualization of neuronal morphology and simulation animations.
- **`components/DisplayWindow.jsx`** / **`GraphWindow.jsx`** — Plotly-based data plots for simulation results.
- **`components/ReactionGraph.jsx`** — Chemical reaction network graph display (visx).

### Backend (`backend/server.py`)

Flask server that orchestrates simulations. Key data structures:
```python
running_processes = {}  # {pid: {process, plot_filename, config_file_path, ...}}
client_sim_map = {}     # {client_id: pid}
sid_clientid_map = {}   # {socket_id: client_id}
```

Key endpoints:
- `POST /launch_simulation` — Saves model JSON, spawns `launch_jardes.py` subprocess
- `POST /upload_file` — Receives uploaded model/data files into `user_uploads/<client_id>/`
- `GET /session_file/<client_id>/<filename>` — Retrieve simulation output files
- `GET /download_project/<client_id>` — Export project as ZIP
- `POST /internal/push_data` — Subprocess posts results here; server forwards via Socket.IO

### MOOSE Engine (`jardesigner/jardesigner.py`)

The `JarDesigner` class (2200+ lines) parses the JSON model config, constructs the MOOSE object hierarchy, runs the simulation, and streams results back. Key methods: `buildModel()`, `display()`, `serverCommandLoop()`.

### Model Config Schema

The `jsonData` structure (defined in `backend/jardesignerSchema.json`) that flows from frontend → backend → engine:
```json
{
  "filetype": "jardesigner",
  "version": "1.0",
  "cellProto": {},        // Neuronal morphology (SWC, NeuroML, or parametric)
  "passiveDistrib": [],   // Passive membrane properties
  "chanProto": [],        // Ion channel definitions
  "chanDistrib": [],      // Channel placement rules
  "chemProto": [],        // Chemical model (SBML/Genesis file references)
  "chemDistrib": [],      // Chemistry placement rules
  "adaptors": [],         // Electrical↔chemical coupling
  "plots": [],            // Data to record and display
  "stims": [],            // Stimulus protocols
  "runtime": 0.3,         // Simulation duration (seconds)
  "elecDt": 50e-6,        // Electrical timestep
  "chemDt": 0.1           // Chemical timestep
}
```

### Data Flow

1. User edits model via MenuBoxes → state updates in `appLogic.js`
2. "Run" triggers `POST /launch_simulation` with full `jsonData`
3. Backend saves config JSON to `user_uploads/<client_id>/`, spawns subprocess
4. `jardesigner.py` builds MOOSE model, runs simulation, POSTs results to `/internal/push_data`
5. Backend emits data to client via Socket.IO → Plotly/Three.js renders results

### Model Libraries

- `backend/CELL_MODELS/` — Example neuronal morphologies
- `backend/CHAN_MODELS/` — Ion channel definitions
- `backend/CHEM_MODELS/` — Chemical reaction models (SBML/Genesis format)

## Build & Deploy
- Build: `npm run build`
- Deploy: `cp -r frontend/dist/* /var/www/html/jardesigner/`
