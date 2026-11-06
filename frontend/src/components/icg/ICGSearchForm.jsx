import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Box, Button, Autocomplete, TextField,
    CircularProgress, TablePagination, Typography,
} from '@mui/material';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

const toItem = (row) => ({
    id:          `icg_${row.modeldb_id}_${row.suffix}`,
    name:        `${row.suffix}_${row.modeldb_id}`,
    source:      row.source || 'ICG',
    description: row.description || [row.title, row.year ? `(${row.year})` : ''].filter(Boolean).join(' '),
    source_type: 'file',
    server_file: `${row.suffix}_${row.modeldb_id}`,
    topTen:      false,
    modeldb_id:  row.modeldb_id,
    suffix:      row.suffix,
    icg_id:      row.icg_id,
    fid:         row.fid,
    ion_class:   row.ion_class,
    title:       row.title,
    authors:     row.authors,
    year:        row.year,
    pubmedid:    row.pubmedid,
    cites:       row.cites,
});

export default function ICGSearchForm({ onResults, footerEl, baseUrl = 'http://localhost:5000' }) {
    const [opts, setOpts]             = useState({ ion_classes: [], suffixes: [], suffixes_by_class: {}, years: [] });
    const [metaLoading, setMetaLoading] = useState(false);
    const [loading, setLoading]       = useState(false);
    const [error, setError]           = useState(null);
    const [page, setPage]             = useState(0);
    const [pageSize, setPageSize]     = useState(DEFAULT_PAGE_SIZE);
    const [rowCount, setRowCount]     = useState(0);
    const lastQuery = useRef(null);

    const [ionClass, setIonClass]   = useState(null);
    const [suffix, setSuffix]       = useState(null);
    const [year, setYear]           = useState(null);
    const [author, setAuthor]       = useState('');
    const [modeldbId, setModeldbId] = useState('');
    const [icgId, setIcgId]         = useState('');

    useEffect(() => {
        setMetaLoading(true);
        fetch(`${baseUrl}/icg/options`)
            .then(r => r.json())
            .then(d => setOpts({
                ion_classes:       d.ion_classes       || [],
                suffixes:          d.suffixes          || [],
                suffixes_by_class: d.suffixes_by_class || {},
                years:             d.years             || [],
            }))
            .catch(console.error)
            .finally(() => setMetaLoading(false));
    }, [baseUrl]);

    const _fetchPage = async (query, pg, pgSize, { showSpinner = false } = {}) => {
        if (showSpinner) setLoading(true);
        setError(null);
        try {
            const resp = await fetch(`${baseUrl}/icg/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...query, page: pg, size: pgSize }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `Search failed (HTTP ${resp.status})`);
            }
            const data = await resp.json();
            setRowCount(data.total || 0);
            setPage(pg);
            onResults((data.channels || []).map(toItem));
        } catch (e) {
            setError(e.message);
            setRowCount(0);
            onResults([]);
        } finally {
            if (showSpinner) setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const query = {
            ion_class:  ionClass  || '',
            suffix:     suffix    || '',
            year:       year      || '',
            author,
            modeldb_id: modeldbId || '',
            icg_id:     icgId     || '',
        };
        lastQuery.current = query;
        await _fetchPage(query, 0, pageSize, { showSpinner: true });
    };

    const handlePageChange = async (_, newPage) => {
        if (lastQuery.current) await _fetchPage(lastQuery.current, newPage, pageSize);
    };

    const handleRowsPerPageChange = async (e) => {
        const newSize = parseInt(e.target.value, 10);
        setPageSize(newSize);
        if (lastQuery.current) await _fetchPage(lastQuery.current, 0, newSize);
    };

    const pagination = rowCount > 0 && (
        <TablePagination
            component="div"
            count={rowCount}
            page={page}
            rowsPerPage={pageSize}
            rowsPerPageOptions={PAGE_SIZE_OPTIONS}
            onPageChange={handlePageChange}
            onRowsPerPageChange={handleRowsPerPageChange}
            sx={{ borderTop: '1px solid #e0e0e0' }}
        />
    );

    return (
        <>
            <Box>
                <form onSubmit={handleSubmit}>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                        <Autocomplete
                            size="small" sx={{ width: 120 }}
                            options={opts.ion_classes}
                            value={ionClass}
                            onChange={(_, val) => { setIonClass(val); setSuffix(null); }}
                            disabled={loading || metaLoading}
                            loading={metaLoading}
                            renderInput={(params) => (
                                <TextField {...params} label="Ion Class" size="small" variant="outlined"
                                    InputProps={{ ...params.InputProps, endAdornment: (<>{metaLoading ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}{params.InputProps.endAdornment}</>) }}
                                />
                            )}
                        />
                        <Autocomplete
                            size="small" sx={{ width: 200 }}
                            options={ionClass ? (opts.suffixes_by_class[ionClass] || []) : opts.suffixes}
                            value={suffix}
                            onChange={(_, val) => setSuffix(val)}
                            disabled={loading || metaLoading}
                            renderInput={(params) => <TextField {...params} label="Channel Name" size="small" variant="outlined" />}
                        />
                        <Autocomplete
                            size="small" sx={{ width: 140 }}
                            options={opts.years}
                            value={year}
                            onChange={(_, val) => setYear(val)}
                            disabled={loading || metaLoading}
                            renderInput={(params) => <TextField {...params} label="Year" size="small" variant="outlined" />}
                        />
                        <TextField
                            size="small" label="Author" variant="outlined" sx={{ width: 160 }}
                            value={author}
                            onChange={e => setAuthor(e.target.value)}
                            disabled={loading}
                        />
                        <TextField
                            size="small" label="ModelDB ID" variant="outlined" sx={{ width: 110 }}
                            value={modeldbId}
                            onChange={e => setModeldbId(e.target.value.replace(/\D/g, ''))}
                            disabled={loading}
                            inputProps={{ inputMode: 'numeric' }}
                        />
                        <TextField
                            size="small" label="ICG ID" variant="outlined" sx={{ width: 90 }}
                            value={icgId}
                            onChange={e => setIcgId(e.target.value.replace(/\D/g, ''))}
                            disabled={loading}
                            inputProps={{ inputMode: 'numeric' }}
                        />
                        <Button type="submit" size="small" variant="contained" disabled={loading || metaLoading}>
                            Search
                        </Button>
                    </Box>
                </form>
                {error && <Typography color="error" variant="body2" sx={{ mt: 0.5 }}>{error}</Typography>}
            </Box>
            {footerEl && pagination && createPortal(pagination, footerEl)}
        </>
    );
}
