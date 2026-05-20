import React, { useState, useRef } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import AllenBrainSearchBar from './AllenBrainSearchBar';
import AllenBrainResultsGrid from './AllenBrainResultsGrid';

const BASE = `http://${window.location.hostname}:5000/allenbrain`;
const SERVER = `http://${window.location.hostname}:5000`;

export default function AllenBrainApp({ clientId, onFileChange, onClose }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);
  const [total, setTotal] = useState(0);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 });
  const [mountMorphology, setMountMorphology] = useState(null);
  const [morphLoading, setMorphLoading] = useState(false);

  const lastQuery = useRef(null);

  const _fetchPage = async (query, page, pageSize) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...query, page, size: pageSize }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Search failed (HTTP ${resp.status})`);
      }
      const data = await resp.json();
      setResults(data.neurons || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.message);
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (query) => {
    lastQuery.current = query;
    setSearched(true);
    const newModel = { page: 0, pageSize: paginationModel.pageSize };
    setPaginationModel(newModel);
    await _fetchPage(query, 0, newModel.pageSize);
  };

  const handlePaginationChange = async (newModel) => {
    setPaginationModel(newModel);
    if (lastQuery.current) {
      await _fetchPage(lastQuery.current, newModel.page, newModel.pageSize);
    }
  };

  const handleSelectMorphology = async (neuron) => {
    if (!neuron) { setMountMorphology(null); return; }
    if (!clientId) { setError('No client session available.'); return; }
    if (!onFileChange) { setError('onFileChange prop is missing.'); return; }

    const specimenId = neuron.specimen__id;
    const specimenName = neuron.specimen__name || `specimen_${specimenId}`;

    setMountMorphology(specimenId);
    setMorphLoading(true);
    setError(null);

    try {
      // Step 1: Download SWC from Allen Brain via backend proxy
      const swcResp = await fetch(`${BASE}/swc/${specimenId}`);
      if (!swcResp.ok) {
        const err = await swcResp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch SWC file');
      }
      const swcText = await swcResp.text();

      // Derive filename from Content-Disposition or fall back
      const disposition = swcResp.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename=(.+)/);
      const filename = match ? match[1].trim() : `${specimenName}.swc`;

      // Step 2: Upload SWC into the client's session directory
      const formData = new FormData();
      const swcBlob = new Blob([swcText], { type: 'text/plain' });
      formData.append('file', swcBlob, filename);
      formData.append('clientId', clientId);

      const uploadResp = await fetch(`${SERVER}/upload_file`, {
        method: 'POST',
        body: formData,
      });
      if (!uploadResp.ok) throw new Error('Failed to upload SWC file to session');

      // Use the filename the server actually saved (secure_filename may have
      // sanitized special characters like the ";" in Allen Brain transgenic
      // line names, e.g. "Pvalb-IRES-Cre;Ai14-...swc").
      const uploadData = await uploadResp.json();
      const savedFilename = uploadData.filename || filename;

      // Step 3: Notify parent — triggers morphology reload
      onFileChange?.({ filename: savedFilename });

      // Step 4: Close dialog
      onClose?.();
    } catch (err) {
      console.error('Allen Brain morphology import failed:', err);
      setError(err.message);
      setMountMorphology(null);
    } finally {
      setMorphLoading(false);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <AllenBrainSearchBar onSearch={handleSearch} loading={loading} />

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          {error}
        </Typography>
      )}

      {searched && !loading && (
        <AllenBrainResultsGrid
          results={results}
          loading={loading}
          morphLoading={morphLoading}
          total={total}
          paginationModel={paginationModel}
          onPaginationModelChange={handlePaginationChange}
          selectMorphology={handleSelectMorphology}
          mountMorphology={mountMorphology}
        />
      )}
    </Box>
  );
}
