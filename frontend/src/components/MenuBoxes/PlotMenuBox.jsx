import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Box,
    Tabs,
    Tab,
    Typography,
    TextField,
    Grid,
    IconButton,
    MenuItem,
    Button,
    Tooltip,
    FormHelperText,
    ListSubheader,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import helpText from './PlotMenuBox.Help.json';
import { formatFloat } from '../../utils/formatters.js';
import { getCompartmentOptions, OPTION_USER_SPECIFIED } from '../../utils/menuHelpers';

// --- Define options outside component ---
const nonChemFieldOptions = [
    'Vm', 'Im', 'inject', 'Gbar', 'Gk', 'Ik', 'ICa', 'Cm', 'Rm', 'Ra',
    'Ca', 'activation', 'current', 'modulation', 'psdArea'
];
const chemFieldOptions = ['n', 'conc', 'volume', 'concInit', 'nInit'];
const modeOptions = ['time', 'space', 'wave', 'raster'];

// --- Helper to safely convert value to string ---
const safeToString = (value, defaultValue = '') => {
    return value !== undefined && value !== null ? String(value) : defaultValue;
};

// --- Regex to parse chem paths like "DEND/Ca[0]" ---
const chemPathRegex = /([^/]+)\/([^[]+)(\[.*\])?/;

// --- Default state for a new plot entry ---
const createDefaultPlot = () => ({
    path: 'soma', // Default to soma
    field: nonChemFieldOptions[0],
    chemProto: '.', 
    childPath: '', 
    molIndex: '',  
    title: '',
    yMin: '0.0',
    yMax: '0.0',
    mode: 'time',
    waveFrames: '100',
});

// --- Reusable HelpField Component ---
const HelpField = React.memo(({ id, label, value, onChange, onBlur, type = "text", fullWidth = true, ...props }) => {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <TextField 
                {...props} 
                fullWidth={fullWidth} 
                size="small" 
                label={label} 
                variant="outlined" 
                type={type}
                value={value} 
                onChange={(e) => onChange(id, e.target.value)}
                onBlur={(e) => onBlur && onBlur(id, e.target.value)}
            />
            <Tooltip title={props.helptext} placement="right">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
            </Tooltip>
        </Box>
    );
});

// --- Main Component ---
const PlotMenuBox = ({ 
    onConfigurationChange, 
    currentConfig, 
    meshMols,
    elecPaths = [],
    spinePaths = [],
    channelPrototypes = [] // List of channel prototype names
}) => {
    const [plots, setPlots] = useState(() => {
        const initialPlots = currentConfig?.map(p => {
            const field = p.field || nonChemFieldOptions[0];
            const isChemField = chemFieldOptions.includes(field);
            let initialChemProto = '.';
            let initialChildPath = '';
            let initialMolIndex = '';

            if (isChemField) {
                const relpath = p.relpath || '';
                const match = relpath.match(chemPathRegex);
                if (match) {
                    initialChemProto = match[1] || '';
                    initialChildPath = match[2] || '';
                    
                    // Logic to strip brackets from loaded index if present
                    let rawIdx = match[3] || '';
                    if (rawIdx.startsWith('[') && rawIdx.endsWith(']')) {
                        rawIdx = rawIdx.substring(1, rawIdx.length - 1);
                    }
                    initialMolIndex = rawIdx;
                } else {
                    const slashIndex = relpath.indexOf('/');
                    if (slashIndex !== -1) {
                        initialChemProto = relpath.substring(0, slashIndex);
                        initialChildPath = relpath.substring(slashIndex + 1);
                    } else {
                        initialChemProto = '';
                        initialChildPath = relpath;
                    }
                }
            } else {
                initialChildPath = p.relpath || '';
            }

            return {
                path: p.path || 'soma',
                field: field,
                chemProto: initialChemProto,
                childPath: initialChildPath,
                molIndex: initialMolIndex,
                title: p.title || '',
                yMin: formatFloat(p.ymin) || '0.0',
                yMax: formatFloat(p.ymax) || '0.0',
                mode: p.mode || 'time',
                waveFrames: safeToString(p.numWaveFrames, '100'),
            };
        }) || [];
        return initialPlots.length > 0 ? initialPlots : [createDefaultPlot()];
    });
    const [activePlot, setActivePlot] = useState(0);

    // --- Dialog State ---
    const [customPathDialogOpen, setCustomPathDialogOpen] = useState(false);
    const [tempCustomPath, setTempCustomPath] = useState('');
    const [pendingPlotIndex, setPendingPlotIndex] = useState(null);
    const [dialogField, setDialogField] = useState('path'); // 'path' or 'childPath'

    const onConfigurationChangeRef = useRef(onConfigurationChange);
    useEffect(() => { onConfigurationChangeRef.current = onConfigurationChange; }, [onConfigurationChange]);
    const plotsRef = useRef(plots);
    useEffect(() => { plotsRef.current = plots; }, [plots]);

    // --- Helper to generate path options ---
    const pathOptions = useMemo(() => {
        const allPaths = [...elecPaths, ...spinePaths];
        const opts = getCompartmentOptions(allPaths);
        
        if (plots[activePlot]) {
            const currentVal = plots[activePlot].path;
            if (currentVal && !opts.includes(currentVal) && currentVal !== OPTION_USER_SPECIFIED) {
                 const last = opts.pop();
                 opts.push(currentVal);
                 opts.push(last);
            }
        }
        return opts;
    }, [elecPaths, spinePaths, plots, activePlot]);

    const addPlot = useCallback(() => {
        setPlots((prev) => [...prev, createDefaultPlot()]);
        setActivePlot(plotsRef.current.length);
    }, []);

    const removePlot = useCallback((indexToRemove) => {
        setPlots((prev) => prev.filter((_, i) => i !== indexToRemove));
        setActivePlot((prev) => Math.max(0, prev - (prev >= indexToRemove ? 1 : 0)));
    }, []);

    const updatePlot = useCallback((index, key, value) => {
        setPlots((prevPlots) =>
            prevPlots.map((plot, i) => {
                if (i === index) {
                    const updatedPlot = { ...plot, [key]: value };
                    
                    if (key === 'field') {
                        const isNowChem = chemFieldOptions.includes(value);
                        const wasChem = chemFieldOptions.includes(plot.field);
                        if (wasChem && !isNowChem) {
                            updatedPlot.chemProto = '.';
                            updatedPlot.childPath = '';
                            updatedPlot.molIndex = '';
                        } else if (!wasChem && isNowChem) {
                            updatedPlot.chemProto = ''; 
                            updatedPlot.childPath = '';
                            updatedPlot.molIndex = '';
                        }
                    }

                    if (key === 'chemProto') {
                        updatedPlot.childPath = ''; 
                        updatedPlot.molIndex = '';  
                    }

                    // Validation for Mol Index (Positive Integers Only)
                    if (key === 'molIndex') {
                        // Allow empty string or non-negative integers only
                        if (value === '' || /^\d+$/.test(value)) {
                            updatedPlot.molIndex = value;
                        } else {
                            return plot; // Reject floats, negatives, or non-digits
                        }
                    }

                    return updatedPlot;
                }
                return plot;
            })
        );
    }, []);

    // --- Custom Path Logic ---
    const handlePathChange = (index, newValue) => {
        if (newValue === OPTION_USER_SPECIFIED) {
            setPendingPlotIndex(index);
            setDialogField('path');
            setTempCustomPath('');
            setCustomPathDialogOpen(true);
        } else {
            updatePlot(index, 'path', newValue);
        }
    };

    const handleSaveCustomPath = () => {
        if (pendingPlotIndex !== null && tempCustomPath.trim() !== "") {
            updatePlot(pendingPlotIndex, dialogField, tempCustomPath.trim());
        }
        setCustomPathDialogOpen(false);
        setPendingPlotIndex(null);
    };

    const handleChildPathChange = (index, newValue) => {
        if (newValue === OPTION_USER_SPECIFIED) {
            setPendingPlotIndex(index);
            setDialogField('childPath');
            setTempCustomPath('');
            setCustomPathDialogOpen(true);
        } else {
            updatePlot(index, 'childPath', newValue);
        }
    };

    const chemCompartmentOptions = useMemo(() => {
        if (!meshMols || typeof meshMols !== 'object') return [];
        return Object.keys(meshMols).sort();
    }, [meshMols]);

    const activePlotData = plots[activePlot];
    const isChemField = activePlotData && chemFieldOptions.includes(activePlotData.field);

    const moleculeOptions = useMemo(() => {
        if (!isChemField || !meshMols || !activePlotData.chemProto) return [];
        const mols = meshMols[activePlotData.chemProto];
        return Array.isArray(mols) ? [...mols].sort() : [];
    }, [isChemField, meshMols, activePlotData?.chemProto]);


    // --- Save/Refresh Logic ---
    const getPlotDataForSave = useCallback(() => {
        return plotsRef.current.map(plotState => {
            if (!plotState.path || !plotState.field) return null;

            const yminNum = parseFloat(plotState.yMin);
            const ymaxNum = parseFloat(plotState.yMax);
            const numWaveFramesInt = parseInt(plotState.waveFrames, 10);
            const isChemField = chemFieldOptions.includes(plotState.field);
            let relpathValue = undefined;

            if (isChemField) {
                if (plotState.chemProto && plotState.childPath) {
                    let idx = plotState.molIndex || '';
                    // Wrap in brackets if integer exists for saving
                    if (idx !== '' && /^\d+$/.test(idx)) {
                        idx = `[${idx}]`;
                    }
                    relpathValue = `${plotState.chemProto}/${plotState.childPath}${idx}`;
                } else { 
                    return null; 
                }
            } else {
                if (plotState.childPath && plotState.childPath !== '') {
                        relpathValue = plotState.childPath;
                }
            }

            const plotSchemaItem = {
                path: plotState.path,
                field: plotState.field,
                ...(relpathValue !== undefined && { relpath: relpathValue }),
                ...(plotState.title && { title: plotState.title }),
                ...((!isNaN(yminNum) && yminNum !== 0) && { ymin: yminNum }),
                ...((!isNaN(ymaxNum) && ymaxNum !== 0) && { ymax: ymaxNum }),
                ...(plotState.mode && plotState.mode !== 'time' && { mode: plotState.mode }),
                ...((plotState.mode === 'wave' && !isNaN(numWaveFramesInt) && numWaveFramesInt !== 0) && { numWaveFrames: numWaveFramesInt }),
            };
            return plotSchemaItem;
        }).filter(item => item !== null);
    }, []);

    const handleRefreshModel = useCallback(() => {
        if (onConfigurationChangeRef.current) {
            const finalConfigData = getPlotDataForSave();
            onConfigurationChangeRef.current({ plots: finalConfigData });
        }
    }, [getPlotDataForSave]);

    useEffect(() => {
        return () => {
            handleRefreshModel();
        };
    }, [handleRefreshModel]);
    
    const getTabLabel = (plot) => {
        const isChem = chemFieldOptions.includes(plot.field);
        if (isChem) {
            const mol = plot.childPath || '?';
            const comp = plot.chemProto || '?';
            return `${mol}@${comp}`;
        }
        return `${plot.field || 'New'} @ ${plot.path || '?'}`;
    };

    const showChemCompartmentWarning = isChemField && !chemCompartmentOptions.length;

    return (
        <Box sx={{ p: 2, background: '#f5f5f5', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="h6" gutterBottom sx={{ mb: 0 }}>Plot Configuration</Typography>
                <Tooltip title={helpText.main} placement="right"><IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={handleRefreshModel} sx={{ ml: 'auto' }}>
                    Refresh Model
                </Button>
            </Box>

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mt: 1 }}>
                <Tabs value={activePlot} onChange={(e, nv) => setActivePlot(nv)} variant="scrollable" scrollButtons="auto">
                    {plots.map((plot, index) => <Tab key={index} label={getTabLabel(plot)} />)}
                    <IconButton onClick={addPlot} sx={{ alignSelf: 'center', ml: '10px' }}><AddIcon /></IconButton>
                </Tabs>
            </Box>

            {activePlotData && (
                <Box sx={{ mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: '4px' }}>
                    <Grid container spacing={2}>
                        {/* 1. Parent Elec Compartment: Top, Full Width, Menu+Dialog */}
                        <Grid item xs={12}>
                             <HelpField 
                                id="path" 
                                label="Parent Elec Compartment" 
                                select
                                value={activePlotData.path} 
                                onChange={(id,v) => handlePathChange(activePlot, v)} 
                                helptext={helpText.fields.path}
                             >
                                {activePlotData.path &&
                                 !pathOptions.includes(activePlotData.path) &&
                                 activePlotData.path !== OPTION_USER_SPECIFIED && (
                                    <MenuItem key="__current__" value={activePlotData.path}>{activePlotData.path}</MenuItem>
                                )}
                                {pathOptions.map(opt => (
                                    <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                                ))}
                             </HelpField>
                        </Grid>

                        <Grid item xs={12} sm={6}>
                            <HelpField id="field" label="Field" select required value={activePlotData.field} onChange={(id, v) => updatePlot(activePlot, id, v)} helptext={helpText.fields.field}>
                                <MenuItem value=""><em>Select Field...</em></MenuItem>
                                <ListSubheader>Electrical/Other</ListSubheader>
                                {nonChemFieldOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                                <ListSubheader>Chemical</ListSubheader>
                                {chemFieldOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                            </HelpField>
                        </Grid>
                         
                        <Grid item xs={12} sm={6}>
                            <HelpField 
                                id="chemProto" 
                                label="Chem Compartment" 
                                select 
                                required={isChemField}
                                value={activePlotData.chemProto} 
                                onChange={(id, v) => updatePlot(activePlot, id, v)} 
                                helptext={helpText.fields.chemProto} 
                                error={isChemField && (showChemCompartmentWarning || !activePlotData.chemProto)}
                                disabled={!isChemField}
                            >
                                <MenuItem value={isChemField ? "" : "."}><em>{isChemField ? "Select..." : "."}</em></MenuItem>
                                {chemCompartmentOptions.map(compName => <MenuItem key={compName} value={compName}>{compName}</MenuItem>)}
                            </HelpField>
                            {isChemField && (showChemCompartmentWarning || !activePlotData.chemProto) && 
                                <FormHelperText error>{showChemCompartmentWarning ? "Warning: No Chem Compartments found" : "Required"}</FormHelperText>}
                        </Grid>
                        
                         {isChemField ? (
                             <>
                                <Grid item xs={12} sm={6}>
                                    <HelpField 
                                        id="childPath" 
                                        label="Molecule Path" 
                                        select 
                                        required 
                                        value={activePlotData.childPath} 
                                        onChange={(id, v) => updatePlot(activePlot, id, v)} 
                                        helptext={helpText.fields.childPath} 
                                        error={!activePlotData.childPath}
                                        disabled={!activePlotData.chemProto}
                                    >
                                        <MenuItem value=""><em>{activePlotData.chemProto ? "Select..." : "Select compartment first"}</em></MenuItem>
                                        {moleculeOptions.map(molName => <MenuItem key={molName} value={molName}>{molName}</MenuItem>)}
                                    </HelpField>
                                    {!activePlotData.childPath && <FormHelperText error>Required</FormHelperText>}
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <HelpField 
                                        id="molIndex" 
                                        label="Molecule Index (int/blank)" 
                                        value={activePlotData.molIndex} 
                                        onChange={(id, v) => updatePlot(activePlot, id, v)} 
                                        helptext="Enter a positive integer index (e.g., 0) or leave blank." 
                                        type="text"
                                    />
                                </Grid>
                             </>
                         ) : (
                             <>
                                 {/* Relative Path as Menu for Non-Chem Fields */}
                                 <Grid item xs={12} sm={6}>
                                    <HelpField
                                        id="childPath"
                                        label="Relative Path (Optional)"
                                        select
                                        value={activePlotData.childPath}
                                        onChange={(id, v) => handleChildPathChange(activePlot, v)}
                                        helptext={helpText.fields.childPath}
                                    >
                                        <MenuItem value=""><em>None</em></MenuItem>
                                        {activePlotData.childPath &&
                                         !channelPrototypes.includes(activePlotData.childPath) &&
                                         activePlotData.childPath !== OPTION_USER_SPECIFIED && (
                                            <MenuItem key="__current_child__" value={activePlotData.childPath}>{activePlotData.childPath}</MenuItem>
                                        )}
                                        {channelPrototypes.map(chan => (
                                            <MenuItem key={chan} value={chan}>{chan}</MenuItem>
                                        ))}
                                        <MenuItem value={OPTION_USER_SPECIFIED}>{OPTION_USER_SPECIFIED}</MenuItem>
                                    </HelpField>
                                </Grid>
                             </>
                         )}
                         
                         <Grid item xs={12} sm={6}><HelpField id="title" label="Title (Optional)" value={activePlotData.title} onChange={(id, v) => updatePlot(activePlot, id, v)} helptext={helpText.fields.title} /></Grid>
                         <Grid item xs={12} sm={6}><HelpField id="yMin" label="Y Min (Optional, 0=auto)" type="number" value={activePlotData.yMin} onChange={(id, v) => updatePlot(activePlot, id, v)} helptext={helpText.fields.yMin} /></Grid>
                         <Grid item xs={12} sm={6}><HelpField id="yMax" label="Y Max (Optional, 0=auto)" type="number" value={activePlotData.yMax} onChange={(id, v) => updatePlot(activePlot, id, v)} helptext={helpText.fields.yMax} /></Grid>
                        
                        {/* Mode moved to bottom next to Wave Frames */}
                        <Grid item xs={12} sm={6}>
                            <HelpField id="mode" label="Mode (Optional)" select value={activePlotData.mode} onChange={(id, v) => updatePlot(activePlot, id, v)} helptext={helpText.fields.mode}>
                                {modeOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                             </HelpField>
                         </Grid>
                        <Grid item xs={12} sm={6}>
                             <HelpField id="waveFrames" label="# Wave Frames (if Mode='wave')" type="number" value={activePlotData.waveFrames} onChange={(id, v) => updatePlot(activePlot, id, v)} helptext={helpText.fields.waveFrames} InputProps={{ inputProps: { min: 0, step: 1 } }} disabled={activePlotData.mode !== 'wave'}/>
                         </Grid>
                    </Grid>
                    <Button variant="outlined" color="secondary" startIcon={<DeleteIcon />} onClick={() => removePlot(activePlot)} sx={{ mt: 2 }}>
                        Remove Plot
                    </Button>
                </Box>
            )}
             {plots.length === 0 && <Typography sx={{ mt: 1, fontStyle: 'italic' }}>No plots defined.</Typography>}

             {/* Dialog for User Specified Path */}
            <Dialog open={customPathDialogOpen} onClose={() => setCustomPathDialogOpen(false)}>
                <DialogTitle>Enter {dialogField === 'path' ? 'Parent Elec Compartment' : 'Relative Path'}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        id="customPath"
                        label="Path"
                        type="text"
                        fullWidth
                        variant="standard"
                        value={tempCustomPath}
                        onChange={(e) => setTempCustomPath(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCustomPathDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleSaveCustomPath}>Set Path</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default PlotMenuBox;
