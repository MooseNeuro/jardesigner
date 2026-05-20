import React, { useState, useEffect, useRef } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import {
  Box,
  Button,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  IconButton,
  Skeleton,
  CircularProgress,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ViewInArIcon from '@mui/icons-material/ViewInAr';       // 3D icon
import PhotoIcon from '@mui/icons-material/Photo';              // section image icon
import GridOnIcon from '@mui/icons-material/GridOn';            // SVG / section overlay icon

const BASE = `http://${window.location.hostname}:5000/allenbrain`;

function thumbFileId(path) {
  if (!path) return null;
  const m = path.match(/well_known_file_download\/(\d+)/);
  return m ? m[1] : null;
}

// Small thumbnail in the grid row
export function MorphThumb({ path, name }) {
  const fileId = thumbFileId(path);
  if (!fileId) return null;
  return (
    <img
      src={`${BASE}/thumb/${fileId}`}
      alt={name}
      style={{ height: 40, width: 40, objectFit: 'contain', borderRadius: 3 }}
      onError={(e) => { e.target.style.display = 'none'; }}
    />
  );
}

/**
 * Smart image for the detail dialog.
 * Strategy:
 *  1. Try 3D Neuron Reconstruction image (morph_thumb_path → well_known_file_download).
 *  2. If unavailable / missing, fall back to Section SVG (vector).
 *  3. If that fails, fall back to Projected Top View JPEG.
 */
function NeuronImagePreview({ neuron }) {
  const [src,     setSrc]     = useState(null);
  const [label,   setLabel]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const blobUrlRef = useRef(null);

  useEffect(() => {
    if (!neuron) return;
    let cancelled = false;
    setSrc(null);
    setLabel(null);
    setLoading(true);
    setMissing(false);

    const fileId     = thumbFileId(neuron.morph_thumb_path);
    const reconUrl   = fileId ? `${BASE}/thumb/${fileId}` : null;
    const svgUrl     = `${BASE}/svg/${neuron.specimen__id}`;
    const sectionUrl = `${BASE}/preview/${neuron.specimen__id}`;

    function setImage(blob, lbl) {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = URL.createObjectURL(blob);
      setSrc(blobUrlRef.current);
      setLabel(lbl);
    }

    async function load() {
      // ── Attempt 1: 3D Neuron Reconstruction (morph_thumb_path) ───────
      if (reconUrl) {
        try {
          const r = await fetch(reconUrl);
          if (r.ok) {
            const blob = await r.blob();
            if (!cancelled) { setImage(blob, '3D Neuron Reconstruction'); return; }
          }
        } catch (_) { /* fall through */ }
      }

      // ── Attempt 2: Section SVG overlay (svg_download — vector) ───────
      try {
        const r = await fetch(svgUrl);
        if (r.ok) {
          const blob = await r.blob();
          if (!cancelled) { setImage(blob, 'Section SVG'); return; }
        }
      } catch (_) { /* fall through */ }

      // ── Attempt 3: Projected Top View JPEG (section_image_download) ──
      try {
        const r = await fetch(sectionUrl);
        if (r.ok) {
          const blob = await r.blob();
          if (!cancelled) { setImage(blob, 'Projected Top View'); return; }
        }
      } catch (_) { /* fall through */ }

      if (!cancelled) setMissing(true);
    }

    load().finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    };
  }, [neuron?.specimen__id]);

  if (loading) {
    return <Skeleton variant="rectangular" width="100%" height={220} sx={{ borderRadius: 1, mt: 1 }} />;
  }

  if (missing || !src) {
    return (
      <Typography variant="caption" color="text.secondary">
        No image available for this specimen.
      </Typography>
    );
  }

  const isRecon = label === '3D Neuron Reconstruction';
  const isSvg   = label === 'Section SVG';

  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
        {isRecon
          ? <ViewInArIcon sx={{ fontSize: '0.9rem', color: 'primary.main' }} />
          : isSvg
            ? <GridOnIcon sx={{ fontSize: '0.9rem', color: 'success.main' }} />
            : <PhotoIcon  sx={{ fontSize: '0.9rem', color: 'text.secondary' }} />}
        <Typography
          variant="caption"
          color={isRecon ? 'primary.main' : isSvg ? 'success.main' : 'text.secondary'}
          sx={{ fontWeight: 600 }}
        >
          {label}
        </Typography>
      </Box>

      <Box sx={{ textAlign: 'center' }}>
        <img
          src={src}
          alt={label}
          style={{
            maxWidth:     '100%',
            maxHeight:    300,
            borderRadius: 4,
            border:       '1px solid #e0e0e0',
            objectFit:    'contain',
          }}
        />
      </Box>
    </Box>
  );
}

// Detail panel
function NeuronDetail({ neuron }) {
  if (!neuron) return null;

  const fields = [
    ['Specimen ID',         neuron.specimen__id],
    ['Species',             neuron.donor__species],
    ['Sex',                 neuron.donor__sex],
    ['Disease State',       neuron.donor__disease_state],
    ['Brain Area',          neuron.structure__name
                              ? `${neuron.structure__acronym} — ${neuron.structure__name}`
                              : neuron.structure__acronym],
    ['Cortical Layer',      neuron.structure__layer],
    ['Hemisphere',          neuron.specimen__hemisphere],
    ['Dendrite Type',       neuron.tag__dendrite_type],
    ['Apical Dendrite',     neuron.tag__apical],
    ['Reconstruction Type', neuron.nr__reconstruction_type],
    ['Morphology Quality',  neuron.nr__morphology_quality],
    ['Transgenic Line',     neuron.line_name],
    ['Reporter Status',     neuron.cell_reporter_status],
    ['Donor Age',           neuron.donor__age],
    ['# Bifurcations',      neuron.nr__number_bifurcations],
    ['# Stems',             neuron.nr__number_stems],
    ['Max Euclidean Dist.', neuron.nr__max_euclidean_distance != null
                              ? `${Number(neuron.nr__max_euclidean_distance).toFixed(1)} µm` : null],
  ];

  return (
    <Box>
      <Typography variant="h6" gutterBottom sx={{ wordBreak: 'break-word' }}>
        {neuron.specimen__name}
      </Typography>
      <Divider sx={{ mb: 1.5 }} />

      {fields.map(([label, value]) =>
        value != null && value !== '' && value !== 'NA' ? (
          <Box key={label} sx={{ mb: 0.6, display: 'flex', gap: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 140, color: 'text.secondary' }}>
              {label}
            </Typography>
            <Typography variant="caption">{String(value)}</Typography>
          </Box>
        ) : null
      )}

      <Divider sx={{ my: 2 }} />

      <NeuronImagePreview neuron={neuron} />
    </Box>
  );
}

export default function AllenBrainResultsGrid({
  results,
  loading,
  morphLoading,
  total,
  paginationModel,
  onPaginationModelChange,
  selectMorphology,
  mountMorphology,
}) {
  const [detailOpen,     setDetailOpen]     = useState(false);
  const [selectedNeuron, setSelectedNeuron] = useState(null);

  const handleDetails = (neuron) => { setSelectedNeuron(neuron); setDetailOpen(true); };

  const columns = [
    {
      field: 'morph_thumb_path',
      headerName: 'Preview',
      width: 70,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <MorphThumb path={params.row.morph_thumb_path} name={params.row.specimen__name} />
      ),
    },
    { field: 'specimen__name',          headerName: 'Specimen Name', width: 220 },
    { field: 'specimen__id',            headerName: 'ID',            width: 100 },
    { field: 'donor__species',          headerName: 'Species',       width: 130 },
    { field: 'tag__dendrite_type',      headerName: 'Dendrite Type', width: 120 },
    { field: 'structure__layer',        headerName: 'Layer',         width: 70  },
    { field: 'structure__acronym',      headerName: 'Brain Area',    width: 110 },
    { field: 'nr__reconstruction_type', headerName: 'Recon',         width: 90  },
    {
      field: '__col_details',
      headerName: 'Details',
      type: 'actions',
      width: 90,
      getActions: (params) => [
        <Button key="details" variant="outlined" size="small"
          onClick={(e) => { e.stopPropagation(); handleDetails(params.row); }}>
          Details
        </Button>,
      ],
    },
    {
      field: '__col_import',
      headerName: 'Import',
      type: 'actions',
      width: 110,
      getActions: (params) => {
        const isSelected = mountMorphology === params.row.specimen__id;
        const isDownloading = isSelected && morphLoading;
        return [
          <Button
            key="import"
            variant={isSelected ? 'contained' : 'outlined'}
            size="small"
            color={isSelected ? 'success' : 'primary'}
            disabled={morphLoading}
            startIcon={isDownloading ? <CircularProgress size={12} color="inherit" /> : null}
            onClick={(e) => { e.stopPropagation(); selectMorphology(isSelected ? null : params.row); }}
          >
            {isDownloading ? 'Loading…' : isSelected ? 'Imported' : 'Import'}
          </Button>,
        ];
      },
    },
  ];

  return (
    <Box sx={{ display: 'flex', height: 480, width: '100%', mt: 2 }}>
      <Box sx={{ flex: 1, height: '100%' }}>
        <DataGrid
          rows={results}
          columns={columns}
          getRowId={(row) => row.specimen__id}
          paginationMode="server"
          rowCount={total}
          paginationModel={paginationModel}
          onPaginationModelChange={onPaginationModelChange}
          pageSizeOptions={[20, 50, 100]}
          loading={loading}
          rowHeight={52}
          showToolbar
          disableRowSelectionOnClick
        />
      </Box>

      <Dialog
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        maxWidth="sm"
        fullWidth
        scroll="paper"
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <span>Neuron Details</span>
          {selectedNeuron && (
            <IconButton
              size="small"
              title="View on Allen Brain Atlas"
              onClick={() =>
                window.open(
                  `https://celltypes.brain-map.org/experiment/morphology/${selectedNeuron.specimen__id}`,
                  '_blank'
                )
              }
            >
              <OpenInNewIcon />
            </IconButton>
          )}
        </DialogTitle>

        <DialogContent dividers sx={{ maxHeight: '70vh' }}>
          <NeuronDetail neuron={selectedNeuron} />
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>Close</Button>
          {selectedNeuron && (
            <Button
              variant="contained"
              onClick={() => { selectMorphology(selectedNeuron); setDetailOpen(false); }}
            >
              Import Morphology
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
