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
    DialogActions,
    Divider
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import helpText from './StimMenuBox.Help.json';
import { getCompartmentOptions, OPTION_USER_SPECIFIED } from '../../utils/menuHelpers';

// --- Define fieldOptions and typeOptions outside ---
const nonChemFieldOptions = ['inject', 'vclamp', 'activation', 'modulation'];
const chemFieldOptions = ['conc', 'concInit', 'n', 'nInit'];
const typeOptions = ['Field', 'Periodic Synapse', 'Random Synapse'];

// --- Regex to parse chem paths like "DEND/Ca[0]" ---
const chemPathRegex = /([^/]+)\/([^[]+)(\[.*\])?/;

// --- Helper to safely convert value to string ---
const safeToString = (value, defaultValue = '') => {
    return value !== undefined && value !== null ? String(value) : defaultValue;
};

// --- Default state for a new stim entry ---
const createDefaultStim = () => ({
    path: 'soma', // Default to soma per request
    field: nonChemFieldOptions[0],
    chemProto: '.', 
    childPath: '', 
    molIndex: '',
    geometryExpression: '1',
    stimulusExpression: '',
    type: typeOptions[0],
    weight: '1.0',
});

// --- Helper to map schema type back to component type ---
const mapSchemaTypeToComponent = (schemaType) => {
    if (schemaType === 'field') return 'Field';
    if (schemaType === 'periodicsyn') return 'Periodic Synapse';
    if (schemaType === 'randsyn') return 'Random Synapse';
    return typeOptions[0];
};

// --- Reusable HelpField Component ---
const HelpField = React.memo(({ id, label, value, onChange, type = "text", fullWidth = true, ...props }) => {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField {...props} fullWidth={fullWidth} size="small" label={label} variant="outlined" type={type}
                value={value} onChange={(e) => onChange(id, e.target.value)} />
            <Tooltip title={props.helptext} placement="right">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
            </Tooltip>
        </Box>
    );
});

// --- Main Component ---
const StimMenuBox = ({ 
    onConfigurationChange, 
    currentConfig, 
    meshMols, 
    elecPaths = [], // Injected: List of electrical paths
    spinePaths = [], // Injected: List of spine paths
    channelPrototypes = [] // Injected: List of channels
}) => {
    const [stims, setStims] = useState(() => {
        const initialStims = currentConfig?.map(s => {
            const field = s.field || nonChemFieldOptions[0];
            const isChemField = s.type === 'field' && chemFieldOptions.includes(field);
            let initialChemProto = '.';
            let initialChildPath = '';
            let initialMolIndex = '';

            if (isChemField) {
                const relpath = s.relpath || '';
                const match = relpath.match(chemPathRegex);
                if (match) {
                    initialChemProto = match[1] || '';
                    initialChildPath = match[2] || '';
                    // Strip brackets for internal state if present
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
                initialChildPath = s.relpath || '';
            }
            return {
                path: s.path || 'soma', // Obtain ParentElecCompartment from 'path'
                field: field,
                chemProto: initialChemProto,
                childPath: initialChildPath,
                molIndex: initialMolIndex,
                geometryExpression: s.geomExpr || '1',
                stimulusExpression: s.expr || '',
                type: mapSchemaTypeToComponent(s.type),
                weight: safeToString(s.weight, '1.0'),
            };
        }) || [];
        return initialStims.length > 0 ? initialStims : [createDefaultStim()];
    });
    const [activeStim, setActiveStim] = useState(0);

    // --- Dialog States ---
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogField, setDialogField] = useState(''); // 'path' or 'childPath'
    const [tempDialogValue, setTempDialogValue] = useState('');

    const onConfigurationChangeRef = useRef(onConfigurationChange);
    useEffect(() => { onConfigurationChangeRef.current = onConfigurationChange; }, [onConfigurationChange]);
    const stimsRef = useRef(stims);
    useEffect(() => { stimsRef.current = stims; }, [stims]);

    const addStim = useCallback(() => {
        setStims((prev) => [...prev, createDefaultStim()]);
        setActiveStim(stimsRef.current.length);
    }, []);

    const removeStim = useCallback((indexToRemove) => {
        setStims((prev) => prev.filter((_, i) => i !== indexToRemove));
        setActiveStim((prev) => Math.max(0, prev - (prev >= indexToRemove ? 1 : 0)));
    }, []);

    const updateStim = useCallback((index, key, value) => {
        setStims((prevStims) =>
            prevStims.map((stim, i) => {
                if (i === index) {
                    const updatedStim = { ...stim, [key]: value };

                    const isNowChem = updatedStim.type === 'Field' && chemFieldOptions.includes(updatedStim.field);

                    if (key === 'field' || key === 'type') {
                        const wasChem = stim.type === 'Field' && chemFieldOptions.includes(stim.field);
                        
                        if (wasChem && !isNowChem) {
                            updatedStim.chemProto = '.';
                            updatedStim.childPath = '';
                            updatedStim.molIndex = '';
                        } else if (!wasChem && isNowChem) {
                            updatedStim.chemProto = ''; // Require user selection
                            updatedStim.childPath = '';
                            updatedStim.molIndex = '';
                        }
                    }

                    // Handle changing compartment
                    if (key === 'chemProto') {
                        updatedStim.childPath = ''; // Reset molecule path
                        updatedStim.molIndex = '';  // Reset index
                    }

                    // Validation for Mol Index (Positive Integers Only)
                    if (key === 'molIndex') {
                        if (value === '' || /^\d+$/.test(value)) {
                            updatedStim.molIndex = value;
                        } else {
                            return stim; // Ignore invalid input
                        }
                    }
                    
                    return updatedStim;
                }
                return stim;
            })
        );
    }, []);

    // --- Dialog Handlers ---
    const handleOpenDialog = (field) => {
        setDialogField(field);
        setTempDialogValue('');
        setDialogOpen(true);
    };

    const handleSaveDialog = () => {
        if (tempDialogValue.trim() !== '') {
            updateStim(activeStim, dialogField, tempDialogValue.trim());
        }
        setDialogOpen(false);
    };

    const handlePathChange = (e) => {
        const val = e.target.value;
        if (val === OPTION_USER_SPECIFIED) {
            handleOpenDialog('path');
        } else {
            updateStim(activeStim, 'path', val);
        }
    };

    const handleChildPathChange = (e) => {
        const val = e.target.value;
        if (val === OPTION_USER_SPECIFIED) {
            handleOpenDialog('childPath');
        } else {
            updateStim(activeStim, 'childPath', val);
        }
    };

    // --- Options Generation ---
    const chemCompartmentOptions = useMemo(() => {
        if (!meshMols || typeof meshMols !== 'object') return [];
        return Object.keys(meshMols).sort();
    }, [meshMols]);

    // Build the Parent Elec Compartment dropdown options via the shared helper.
    // Shafts are filtered, base# wildcards added, individuals capped at 10.
    const elecCompartmentOptions = useMemo(() =>
        getCompartmentOptions([...elecPaths, ...spinePaths]),
    [elecPaths, spinePaths]);

    // Get active plot data
    const activeStimData = stims[activeStim];
    const isFieldType = activeStimData && activeStimData.type === 'Field';
    const isChemField = isFieldType && chemFieldOptions.includes(activeStimData.field);

    const moleculeOptions = useMemo(() => {
        if (!isChemField || !meshMols || !activeStimData.chemProto) return [];
        const mols = meshMols[activeStimData.chemProto];
        return Array.isArray(mols) ? [...mols].sort() : [];
    }, [isChemField, meshMols, activeStimData?.chemProto]);


    // --- Save/Refresh Logic ---
    const getStimDataForSave = useCallback(() => {
        return stimsRef.current.map(stimState => {
            let schemaType = 'field';
            if (stimState.type === 'Periodic Synapse') schemaType = 'periodicsyn';
            if (stimState.type === 'Random Synapse') schemaType = 'randsyn';
            
            const isChemField = schemaType === 'field' && chemFieldOptions.includes(stimState.field);
            let relpathValue = undefined;

            if (isChemField) {
                if (stimState.chemProto && stimState.childPath) {
                    let idx = stimState.molIndex || '';
                    // Wrap in brackets if integer exists
                    if (idx !== '' && /^\d+$/.test(idx)) {
                        idx = `[${idx}]`;
                    }
                    relpathValue = `${stimState.chemProto}/${stimState.childPath}${idx}`;
                } else { return null; }
            } else {
                if (stimState.childPath !== undefined) {
                     relpathValue = stimState.childPath;
                }
            }
            
            const stimSchemaItemBase = {
                type: schemaType,
                path: stimState.path || "soma",
                ...(relpathValue !== undefined && relpathValue !== '' && { relpath: relpathValue }),
                ...(stimState.geometryExpression && stimState.geometryExpression !== '1' && { geomExpr: stimState.geometryExpression }),
                expr: stimState.stimulusExpression || "",
            };
            
            if (schemaType === 'field') {
                if (!stimSchemaItemBase.path || !stimState.field || !stimSchemaItemBase.expr) return null;
                if (isChemField && !relpathValue) return null;
                stimSchemaItemBase.field = stimState.field;
            } else {
                    const weightNum = parseFloat(stimState.weight);
                    // Synapse types require a relpath (which stores channel/synapse name here)
                    if (!stimSchemaItemBase.path || isNaN(weightNum) || !stimSchemaItemBase.expr || relpathValue === undefined || relpathValue === '') return null;
                    stimSchemaItemBase.weight = weightNum;
            }
            return stimSchemaItemBase;
        }).filter(item => item !== null);
    }, []); 

    const handleRefreshModel = useCallback(() => {
        if (onConfigurationChangeRef.current) {
            const finalConfigData = getStimDataForSave();
            onConfigurationChangeRef.current({ stims: finalConfigData });
        }
    }, [getStimDataForSave]);

    useEffect(() => {
        return () => {
            handleRefreshModel();
        };
    }, [handleRefreshModel]);

    const getTabLabel = (stim) => {
        const isChem = stim.type === 'Field' && chemFieldOptions.includes(stim.field);
        if (isChem) {
            const mol = stim.childPath || '?';
            const comp = stim.chemProto || '?';
            return `${mol}@${comp}`;
        }

        const path = stim.path || 'soma';
        const relPath = stim.childPath || '';
        const fullPath = `${path}${relPath ? '/' + relPath : ''}`;

        if (stim.type === 'Random Synapse') {
            return `Poisson@${fullPath}`;
        }
        
        if (stim.type === 'Periodic Synapse') {
            return `Periodic@${fullPath}`;
        }

        return `${stim.type || 'New'} @ ${path}`;
    };

    const showChemCompartmentWarning = isChemField && !chemCompartmentOptions.length;

    return (
        <Box sx={{ p: 2, background: '#f5f5f5', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="h6" gutterBottom sx={{ mb: 0 }}>Stimulus Configuration</Typography>
                <Tooltip title={helpText.main} placement="right"><IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={handleRefreshModel} sx={{ ml: 'auto' }}>
                    Refresh Model
                </Button>
            </Box>
             <Box sx={{ borderBottom: 1, borderColor: 'divider', mt: 1 }}>
                 <Tabs value={activeStim} onChange={(e, nv) => setActiveStim(nv)} variant="scrollable" scrollButtons="auto">
                     {stims.map((stim, index) => <Tab key={index} label={getTabLabel(stim)} />)}
                      <IconButton onClick={addStim} sx={{ alignSelf: 'center', ml: '10px' }}><AddIcon /></IconButton>
                  </Tabs>
              </Box>
              {activeStimData && (
                  <Box sx={{ mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: '4px' }}>
                      <Grid container spacing={2}>
                          
                          {/* 1. Parent Elec Compartment - First Row, Full Width */}
                          <Grid item xs={12}>
                              <HelpField 
                                id="path" 
                                label="Parent Elec Compartment" 
                                select 
                                required 
                                value={activeStimData.path} 
                                onChange={(id, v) => handlePathChange({ target: { value: v } })} 
                                helptext={helpText.fields.path}
                              >
                                  {/* If the current value was user-typed, show it so MUI can display it as selected */}
                                  {activeStimData.path &&
                                   !elecCompartmentOptions.includes(activeStimData.path) &&
                                   activeStimData.path !== OPTION_USER_SPECIFIED && (
                                      <MenuItem key="__current__" value={activeStimData.path}>{activeStimData.path}</MenuItem>
                                  )}
                                  {elecCompartmentOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                              </HelpField>
                          </Grid>

                          <Grid item xs={12} sm={6}>
                              <HelpField id="type" label="Type" select required value={activeStimData.type} onChange={(id, v) => updateStim(activeStim, id, v)} helptext={helpText.fields.type}>{typeOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}</HelpField>
                          </Grid>
                          
                          {isFieldType && (
                            <Grid item xs={12} sm={6}>
                                <HelpField id="field" label="Field" select required value={activeStimData.field} onChange={(id, v) => updateStim(activeStim, id, v)} helptext={helpText.fields.field}>
                                    <MenuItem value=""><em>Select Field...</em></MenuItem>
                                    <ListSubheader>Electrical/Other</ListSubheader>
                                    {nonChemFieldOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                                    <ListSubheader>Chemical</ListSubheader>
                                    {chemFieldOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                                </HelpField>
                            </Grid>
                          )}
                          
                          {!isFieldType && (
                              <Grid item xs={12} sm={6}>
                                  <HelpField id="weight" label="Weight" type="number" required value={activeStimData.weight} onChange={(id, v) => updateStim(activeStim, id, v)} helptext={helpText.fields.weight} InputProps={{ inputProps: { step: 0.1 } }} />
                              </Grid>
                          )}

                          {/* Conditional Rendering based on Field Type */}
                          {isChemField ? (
                            // --- Chemical Field Logic ---
                             <>
                                <Grid item xs={12} sm={6}>
                                      <HelpField 
                                          id="chemProto" 
                                          label="Chem Compartment" 
                                          select 
                                          required={isChemField}
                                          value={activeStimData.chemProto} 
                                          onChange={(id, v) => updateStim(activeStim, id, v)} 
                                          helptext={helpText.fields.chemProto} 
                                          error={isChemField && (showChemCompartmentWarning || !activeStimData.chemProto)}
                                          disabled={!isChemField}
                                      >
                                          <MenuItem value={isChemField ? "" : "."}><em>{isChemField ? "Select..." : "."}</em></MenuItem>
                                          {chemCompartmentOptions.map(compName => <MenuItem key={compName} value={compName}>{compName}</MenuItem>)}
                                      </HelpField>
                                      {isChemField && (showChemCompartmentWarning || !activeStimData.chemProto) && 
                                          <FormHelperText error>{showChemCompartmentWarning ? "Warning: No Chem Compartments found" : "Required"}</FormHelperText>}
                                </Grid>

                                <Grid item xs={12} sm={6}>
                                    <HelpField 
                                        id="childPath" 
                                        label="Molecule Path" 
                                        select 
                                        required 
                                        value={activeStimData.childPath} 
                                        onChange={(id, v) => updateStim(activeStim, id, v)} 
                                        helptext={helpText.fields.childPath}
                                        error={!activeStimData.childPath}
                                        disabled={!activeStimData.chemProto}
                                    >
                                        <MenuItem value=""><em>{activeStimData.chemProto ? "Select..." : "Select compartment first"}</em></MenuItem>
                                        {moleculeOptions.map(molName => <MenuItem key={molName} value={molName}>{molName}</MenuItem>)}
                                    </HelpField>
                                    {!activeStimData.childPath && <FormHelperText error>Required</FormHelperText>}
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <HelpField 
                                        id="molIndex" 
                                        label="Molecule Index (int/blank)" 
                                        value={activeStimData.molIndex} 
                                        onChange={(id, v) => updateStim(activeStim, id, v)} 
                                        helptext="Enter a positive integer index (e.g., 0) or leave blank." 
                                        type="text"
                                    />
                                </Grid>
                             </>
                         ) : (
                             // --- Non-Chemical (Electrical/Synapse) Logic ---
                             <Grid item xs={12} sm={6}>
                                <HelpField 
                                    id="childPath" 
                                    label="Relative Path (Optional)" 
                                    select
                                    value={activeStimData.childPath} 
                                    onChange={(id, v) => handleChildPathChange({ target: { value: v } })} 
                                    helptext="Select an Ion Channel Prototype or specify custom."
                                >
                                    <MenuItem value=""><em>None</em></MenuItem>
                                    {channelPrototypes.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                                    <Divider />
                                    <MenuItem value={OPTION_USER_SPECIFIED}>{OPTION_USER_SPECIFIED}</MenuItem>
                                </HelpField>
                            </Grid>
                         )}

                          <Grid item xs={12} sm={6}>
                              <HelpField 
                                id="geometryExpression" 
                                label="Geometry Expr" 
                                value={activeStimData.geometryExpression} 
                                onChange={(id, v) => updateStim(activeStim, id, v)} 
                                helptext={helpText.fields.geometryExpression}
                            />
                          </Grid>

                          {/* Stimulus Expression - Full Width, Last Row */}
                          <Grid item xs={12}>
                              <HelpField 
                                id="stimulusExpression" 
                                label="Stimulus Expression" 
                                required 
                                value={activeStimData.stimulusExpression} 
                                onChange={(id, v) => updateStim(activeStim, id, v)} 
                                helptext={helpText.fields.stimulusExpression}
                            />
                          </Grid>
                      </Grid>

                      <Button variant="outlined" color="secondary" startIcon={<DeleteIcon />} onClick={() => removeStim(activeStim)} sx={{ mt: 2 }}>Remove Stim</Button>
                  </Box>
              )}
             {stims.length === 0 && <Typography sx={{ mt: 1, fontStyle: 'italic' }}>No stimuli defined.</Typography>}

            {/* Dialog for User Specified Inputs */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
                <DialogTitle>Enter {dialogField === 'path' ? 'Parent Elec Compartment' : 'Relative Path'}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="Value"
                        type="text"
                        fullWidth
                        variant="standard"
                        value={tempDialogValue}
                        onChange={(e) => setTempDialogValue(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleSaveDialog}>Set</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default StimMenuBox;
