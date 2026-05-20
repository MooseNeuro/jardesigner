import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  FormControlLabel,
  Checkbox,
  FormControl,
  Select,
  MenuItem,
  Typography,
  Divider,
  Collapse,
  Link,
  CircularProgress,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import TuneIcon from '@mui/icons-material/Tune';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

const BASE = `http://${window.location.hostname}:5000/allenbrain`;

const SPECIES = {
  human: 'Homo Sapiens',
  mouse: 'Mus musculus',
};

// Sort key for layer strings: "1"→1, "2/3"→2.33, "6a"→6.1, "6b"→6.2
function layerSortKey(l) {
  if (l.includes('/')) {
    const [a, b] = l.split('/').map(Number);
    return a + 1 / (b + 1);
  }
  const m = l.match(/^(\d+)([a-z]?)$/);
  if (m) return Number(m[1]) + ({ a: 0.1, b: 0.2, c: 0.3 }[m[2]] || 0);
  return 99;
}

function buildLayerOpts(humanLayers, mouseLayers, showHuman, showMouse) {
  const humanSet = new Set(humanLayers);
  const mouseSet = new Set(mouseLayers);
  const union = new Set([
    ...(showHuman ? humanLayers : []),
    ...(showMouse ? mouseLayers : []),
  ]);
  return [...union]
    .sort((a, b) => layerSortKey(a) - layerSortKey(b))
    .map((layer) => {
      const inHuman = humanSet.has(layer);
      const inMouse = mouseSet.has(layer);
      let label = `Layer ${layer}`;
      if (showHuman && showMouse) {
        if (inHuman && !inMouse) label += ' (Human)';
        if (inMouse && !inHuman) label += ' (Mouse)';
      }
      return { label, value: layer };
    });
}

function SectionLabel({ children }) {
  return (
    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, mt: 1.5 }}>
      {children}
    </Typography>
  );
}

const EMPTY_FILTERS = {
  area:               '',
  layer:              '',
  dendrite_type:      '',
  apical:             '',
  reconstruction_type:'',
  line_name:          '',
};

export default function AllenBrainSearchBar({ onSearch, loading }) {
  const [human, setHuman] = useState(false);
  const [mouse, setMouse] = useState(false);

  const [humanMeta, setHumanMeta]     = useState(null);
  const [mouseMeta, setMouseMeta]     = useState(null);
  const [metaLoading, setMetaLoading] = useState(false);

  const [globalOpts, setGlobalOpts]       = useState(null);
  const [globalLoading, setGlobalLoading] = useState(true);

  const [f, setF]               = useState(EMPTY_FILTERS);
  const [morphOpen, setMorphOpen] = useState(false);

  // Load global morphology annotation options once
  useEffect(() => {
    fetch(`${BASE}/filters`)
      .then((r) => r.json())
      .then((d) => setGlobalOpts(d))
      .finally(() => setGlobalLoading(false));
  }, []);

  // Fetch species metadata whenever human/mouse checkbox changes
  useEffect(() => {
    const fetches = [];
    setMetaLoading(true);

    if (human && !humanMeta) {
      fetches.push(
        fetch(`${BASE}/metadata?species=${encodeURIComponent(SPECIES.human)}`)
          .then((r) => r.json())
          .then((d) => setHumanMeta(d))
      );
    }
    if (mouse && !mouseMeta) {
      fetches.push(
        fetch(`${BASE}/metadata?species=${encodeURIComponent(SPECIES.mouse)}`)
          .then((r) => r.json())
          .then((d) => setMouseMeta(d))
      );
    }

    Promise.all(fetches).finally(() => setMetaLoading(false));
  }, [human, mouse]);

  const toggleHuman = () => { setHuman((v) => !v); setF(EMPTY_FILTERS); };
  const toggleMouse = () => { setMouse((v) => !v); setF(EMPTY_FILTERS); };

  const speciesChosen = human || mouse;

  // Merge brain areas from selected species; preserve is_parent for correct filter routing
  const areaMap = {};
  if (human && humanMeta) humanMeta.brain_areas.forEach((a) => { areaMap[a.acronym] = a; });
  if (mouse && mouseMeta) mouseMeta.brain_areas.forEach((a) => { areaMap[a.acronym] = a; });
  const areaOpts = Object.entries(areaMap).sort(([a], [b]) => a.localeCompare(b));

  // Layers with species annotations
  const humanLayers = humanMeta?.layers || [];
  const mouseLayers = mouseMeta?.layers || [];
  const layerOpts   = buildLayerOpts(humanLayers, mouseLayers, human, mouse);

  // Transgenic lines (mouse only)
  const lineOpts = mouse && mouseMeta ? mouseMeta.line_names : [];

  // Morphology annotation options
  const dendriteOpts = globalOpts?.dendrite_types      || [];
  const apicalOpts   = globalOpts?.apical              || [];
  const reconOpts    = globalOpts?.reconstruction_types || [];

  const hasFilters = speciesChosen || Object.values(f).some((v) => v !== '');

  const handleReset = () => {
    setHuman(false);
    setMouse(false);
    setF(EMPTY_FILTERS);
    setMorphOpen(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!speciesChosen) return;

    let speciesFilter = '';
    if (human && !mouse) speciesFilter = SPECIES.human;
    if (mouse && !human) speciesFilter = SPECIES.mouse;

    const areaIsParent = f.area ? (areaMap[f.area]?.is_parent ?? false) : false;

    onSearch({
      species:                   speciesFilter,
      brain_area_acronym:        areaIsParent ? '' : f.area,
      brain_area_parent_acronym: areaIsParent ? f.area : '',
      layer:                     f.layer,
      dendrite_type:             f.dendrite_type,
      apical:                    f.apical,
      reconstruction_type:       f.reconstruction_type,
      line_name:                 f.line_name,
    });
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>

      {/* ── Species checkboxes ─────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
        <FormControlLabel
          control={<Checkbox checked={human} onChange={toggleHuman} size="small" />}
          label={<Typography variant="body2">Human</Typography>}
          sx={{ mr: 0 }}
        />
        <FormControlLabel
          control={<Checkbox checked={mouse} onChange={toggleMouse} size="small" />}
          label={<Typography variant="body2">Mouse</Typography>}
        />
        {metaLoading && <CircularProgress size={14} />}
      </Box>

      {speciesChosen && (
        <>
          <Divider />

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1, alignItems: 'flex-end' }}>

            {/* ── Location ───────────────────────────────────────────── */}
            <Box sx={{ minWidth: 240 }}>
              <SectionLabel>Location</SectionLabel>
              <FormControl fullWidth size="small" variant="standard">
                <Select
                  displayEmpty
                  value={f.area}
                  onChange={(e) => setF((p) => ({ ...p, area: e.target.value, layer: '' }))}
                  renderValue={(v) => v
                    ? `${v} — ${areaMap[v]?.name || ''}`
                    : <span style={{ color: '#888' }}>Select Areas</span>
                  }
                >
                  <MenuItem value=""><em>Any</em></MenuItem>
                  {areaOpts.map(([acr, entry]) => (
                    <MenuItem key={acr} value={acr}>{acr} — {entry.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* ── Cortical Layer ─────────────────────────────────────── */}
            <Box sx={{ minWidth: 200 }}>
              <SectionLabel>Cortical Layer</SectionLabel>
              <FormControl fullWidth size="small" variant="standard">
                <Select
                  displayEmpty
                  value={f.layer}
                  onChange={(e) => setF((p) => ({ ...p, layer: e.target.value }))}
                  renderValue={(v) => {
                    const opt = layerOpts.find((o) => o.value === v);
                    return opt ? opt.label : <span style={{ color: '#888' }}>Select Layer</span>;
                  }}
                >
                  <MenuItem value=""><em>Any</em></MenuItem>
                  {layerOpts.map((o) => (
                    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* ── Transgenic Line (mouse only) ───────────────────────── */}
            {mouse && lineOpts.length > 0 && (
              <Box sx={{ minWidth: 240 }}>
                <SectionLabel>Transgenic Line</SectionLabel>
                <FormControl fullWidth size="small" variant="standard">
                  <Select
                    displayEmpty
                    value={f.line_name}
                    onChange={(e) => setF((p) => ({ ...p, line_name: e.target.value }))}
                    renderValue={(v) => v || <span style={{ color: '#888' }}>Select Line</span>}
                  >
                    <MenuItem value=""><em>Any</em></MenuItem>
                    {lineOpts.map((l) => <MenuItem key={l} value={l}>{l}</MenuItem>)}
                  </Select>
                </FormControl>
              </Box>
            )}

          </Box>

          {/* ── Morphology Annotation — collapsible ────────────────── */}
          <Box sx={{ mt: 1.5 }}>
            <Link
              component="button"
              type="button"
              underline="hover"
              onClick={() => setMorphOpen((v) => !v)}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: '0.8rem', color: 'text.secondary' }}
            >
              <TuneIcon sx={{ fontSize: '1rem' }} />
              Morphology Annotation
              {morphOpen
                ? <KeyboardArrowUpIcon   sx={{ fontSize: '1rem' }} />
                : <KeyboardArrowDownIcon sx={{ fontSize: '1rem' }} />}
            </Link>

            <Collapse in={morphOpen}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'grey.50' }}>

                <Box sx={{ minWidth: 180 }}>
                  <SectionLabel>Dendrite Type</SectionLabel>
                  <FormControl fullWidth size="small" variant="standard">
                    <Select displayEmpty value={f.dendrite_type}
                      onChange={(e) => setF((p) => ({ ...p, dendrite_type: e.target.value }))}
                      renderValue={(v) => v || <span style={{ color: '#888' }}>Any</span>}>
                      <MenuItem value=""><em>Any</em></MenuItem>
                      {dendriteOpts.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Box>

                <Box sx={{ minWidth: 180 }}>
                  <SectionLabel>Apical Dendrite</SectionLabel>
                  <FormControl fullWidth size="small" variant="standard">
                    <Select displayEmpty value={f.apical}
                      onChange={(e) => setF((p) => ({ ...p, apical: e.target.value }))}
                      renderValue={(v) => v || <span style={{ color: '#888' }}>Any</span>}>
                      <MenuItem value=""><em>Any</em></MenuItem>
                      {apicalOpts.map((a) => <MenuItem key={a} value={a}>{a}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Box>

                <Box sx={{ minWidth: 180 }}>
                  <SectionLabel>Reconstruction</SectionLabel>
                  <FormControl fullWidth size="small" variant="standard">
                    <Select displayEmpty value={f.reconstruction_type}
                      onChange={(e) => setF((p) => ({ ...p, reconstruction_type: e.target.value }))}
                      renderValue={(v) => v || <span style={{ color: '#888' }}>Any</span>}>
                      <MenuItem value=""><em>Any</em></MenuItem>
                      {reconOpts.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Box>

              </Box>
            </Collapse>
          </Box>
        </>
      )}

      {/* ── Action row ─────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
        <Button
          type="submit"
          variant="contained"
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
          disabled={loading || !speciesChosen}
          sx={{ minWidth: 110 }}
        >
          {loading ? 'Searching…' : 'Search'}
        </Button>
        {hasFilters && (
          <Button size="small" startIcon={<RestartAltIcon />} onClick={handleReset}>
            Reset
          </Button>
        )}
      </Box>

    </Box>
  );
}
