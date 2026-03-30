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
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import helpText from './ElecMenuBox.Help.json';
import { getCompartmentOptions, OPTION_USER_SPECIFIED } from '../../utils/menuHelpers';

// --- Helper Functions ---
const getChannelSourceString = (componentType) => {
    switch (componentType) {
        case 'Na_HH':   return 'make_HH_Na()';
        case 'Na':      return 'make_Na()';
        case 'KDR_HH':  return 'make_HH_K()';
        case 'KDR':     return 'make_K_DR()';
        case 'K_A':     return 'make_K_A()';
        case 'Ca':      return 'make_Ca()';
        case 'LCa':     return 'make_LCa()';
        case 'Ca_conc': return 'make_Ca_conc()';
        case 'K_AHP':   return 'make_K_AHP()';
        case 'K_C':     return 'make_K_C()';
        case 'gluR':    return 'make_glu()';
        case 'NMDAR':   return 'make_NMDA()';
        case 'GABAR':   return 'make_GABA()';
        case 'leak':    return 'make_leak()';
        default:        return componentType; // Fallback for 'File'
    }
};

const prototypeTypeOptions = [
    'Na_HH', 'Na', 'KDR_HH', 'KDR', 'K_A', 'Ca', 'LCa', 'Ca_conc',
    'K_AHP', 'K_C', 'gluR', 'NMDAR', 'GABAR', 'leak', 'File'
];

const safeToString = (value, defaultValue = '') => {
    return value !== undefined && value !== null ? String(value) : defaultValue;
};

// --- Default State Definitions ---
const createDefaultPrototype = () => ({
    type: prototypeTypeOptions[0],
    name: prototypeTypeOptions[0],
    file: '',
    manualName: false,
});
const createDefaultDistribution = () => ({
    prototype: '',
    path: 'soma',
    maxConductance: '1.0',
    caTau: '0.013',
});


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
const ElecMenuBox = ({ 
    onConfigurationChange, 
    currentConfig, 
    clientId, 
    elecPaths = [], 
    spinePaths = [] 
}) => {
    const [prototypes, setPrototypes] = useState(() => {
        const initialProtos = currentConfig?.chanProto?.map(p => {
            let componentType = p.source;
            let file = '';
            if (p.type === 'neuroml') {
                componentType = 'File';
                file = p.source || '';
            }
            const matchingTypeOption = prototypeTypeOptions.find(opt => getChannelSourceString(opt) === p.source || opt === p.source);
            if (matchingTypeOption && p.type !== 'neuroml') {
                 componentType = matchingTypeOption;
            }
            return { type: componentType, name: p.name, file: file, manualName: p.name !== componentType };
        }) || [];
        return initialProtos.length > 0 ? initialProtos : [createDefaultPrototype()];
    });

    const [distributions, setDistributions] = useState(() => {
        const initialDists = currentConfig?.chanDistrib?.map(d => ({
            prototype: d.proto,
            path: d.path,
            maxConductance: safeToString(d.Gbar, '0'),
            caTau: safeToString(d.tau, '0.013'),
        })) || [];
        return initialDists.length > 0 ? initialDists : [createDefaultDistribution()];
    });

    const [activePrototype, setActivePrototype] = useState(0);
    const [activeDistribution, setActiveDistribution] = useState(0);

    // --- State for User Specified Path Dialog ---
    const [customPathDialogOpen, setCustomPathDialogOpen] = useState(false);
    const [tempCustomPath, setTempCustomPath] = useState('');
    const [pendingDistIndex, setPendingDistIndex] = useState(null);

    const onConfigurationChangeRef = useRef(onConfigurationChange);
    useEffect(() => { onConfigurationChangeRef.current = onConfigurationChange; }, [onConfigurationChange]);
    const prototypesRef = useRef(prototypes);
    useEffect(() => { prototypesRef.current = prototypes; }, [prototypes]);
    const distributionsRef = useRef(distributions);
    useEffect(() => { distributionsRef.current = distributions; }, [distributions]);

    const fileInputRef = useRef(null);

    // --- Helper to generate path options ---
    const pathOptions = useMemo(() => {
        // Use both elecPaths and spinePaths for allowed compartments
        const allPaths = [...elecPaths, ...spinePaths];
        const opts = getCompartmentOptions(allPaths);
        
        // Ensure the current value is in the list if it's not standard
        if (distributions[activeDistribution]) {
            const currentVal = distributions[activeDistribution].path;
            if (currentVal && !opts.includes(currentVal) && currentVal !== OPTION_USER_SPECIFIED) {
                 const last = opts.pop();
                 opts.push(currentVal);
                 opts.push(last);
            }
        }
        return opts;
    }, [elecPaths, spinePaths, distributions, activeDistribution]);

    const addPrototype = useCallback(() => {
        setPrototypes((prev) => [...prev, createDefaultPrototype()]);
        setActivePrototype(prototypes.length);
    }, [prototypes]);

    const removePrototype = useCallback((indexToRemove) => {
        const removedProtoName = prototypesRef.current[indexToRemove]?.name;
        setPrototypes((prev) => prev.filter((_, i) => i !== indexToRemove));
        setDistributions(prevDists => prevDists.map(dist =>
            dist.prototype === removedProtoName ? { ...dist, prototype: '' } : dist
        ));
        setActivePrototype((prev) => Math.max(0, prev - (prev >= indexToRemove ? 1 : 0)));
    }, []);

    const updatePrototype = useCallback((index, key, value) => {
        setPrototypes((prevPrototypes) =>
            prevPrototypes.map((proto, i) => {
                if (i === index) {
                    const updatedProto = { ...proto, [key]: value };
                    if (key === 'type' && !updatedProto.manualName) {
                        updatedProto.name = value;
                    }
                    if (key === 'type' && value !== 'File') {
                        updatedProto.file = '';
                    }
                    return updatedProto;
                }
                return proto;
            })
        );
    }, []);

    const setCustomPrototypeName = useCallback((index, value) => {
        setPrototypes((prevPrototypes) =>
            prevPrototypes.map((proto, i) =>
                i === index ? { ...proto, name: value, manualName: true } : proto
            )
        );
    }, []);

    const handleFileSelect = () => fileInputRef.current.click();

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file || !clientId) return;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('clientId', clientId);

        try {
            const uploadUrl = `http://${window.location.hostname}:5000/upload_file`;
            const response = await fetch(uploadUrl, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'File upload failed');
            }
            updatePrototype(activePrototype, 'file', file.name);
            
        } catch (error) {
            console.error("Error uploading channel file:", error);
            alert(`Failed to upload the selected file: ${error.message}`);
        }
    };

    const addDistribution = useCallback(() => {
        setDistributions((prev) => [...prev, createDefaultDistribution()]);
        setActiveDistribution(distributions.length);
    }, [distributions]);

    const removeDistribution = useCallback((indexToRemove) => {
        setDistributions((prev) => prev.filter((_, i) => i !== indexToRemove));
        setActiveDistribution((prev) => Math.max(0, prev - (prev >= indexToRemove ? 1 : 0)));
    }, []);

    const updateDistribution = useCallback((index, key, value) => {
        setDistributions((prevDists) =>
            prevDists.map((dist, i) =>
                i === index ? { ...dist, [key]: value } : dist
            )
        );
    }, []);

    // --- Custom Path Handling ---
    const handlePathChange = (index, newValue) => {
        if (newValue === OPTION_USER_SPECIFIED) {
            setPendingDistIndex(index);
            setTempCustomPath('');
            setCustomPathDialogOpen(true);
        } else {
            updateDistribution(index, 'path', newValue);
        }
    };

    const handleSaveCustomPath = () => {
        if (pendingDistIndex !== null && tempCustomPath.trim() !== "") {
            updateDistribution(pendingDistIndex, 'path', tempCustomPath.trim());
        }
        setCustomPathDialogOpen(false);
        setPendingDistIndex(null);
    };

    useEffect(() => {
        const getElecDataForUnmount = () => {
            const currentPrototypes = prototypesRef.current;
            const currentDistributions = distributionsRef.current;

            const chanProtoData = currentPrototypes.map(protoState => {
                let schemaType = "builtin";
                let schemaSource = "";
                if (protoState.type === 'File') {
                    schemaType = "neuroml";
                    schemaSource = protoState.file || "";
                } else {
                    schemaSource = getChannelSourceString(protoState.type);
                }
                if (!protoState.name || !schemaSource) { return null; }
                return { type: schemaType, source: schemaSource, name: protoState.name };
            }).filter(p => p !== null);

            const chanDistribData = currentDistributions.map(distState => {
                const distribSchemaItem = { proto: distState.prototype || "", path: distState.path || "soma" };
                const selectedPrototype = currentPrototypes.find(p => p.name === distState.prototype);

                if (selectedPrototype && selectedPrototype.type === 'Ca_conc') {
                     distribSchemaItem.tau = parseFloat(distState.caTau) || 0.013;
                } else {
                     distribSchemaItem.Gbar = parseFloat(distState.maxConductance) || 0;
                }
                if (!distribSchemaItem.proto || !distribSchemaItem.path || (distribSchemaItem.Gbar === undefined && distribSchemaItem.tau === undefined)) {
                     return null;
                 }
                return distribSchemaItem;
            }).filter(item => item !== null);

            return { chanProto: chanProtoData, chanDistrib: chanDistribData };
        };

        return () => {
            if (onConfigurationChangeRef.current) {
                const configData = getElecDataForUnmount();
                onConfigurationChangeRef.current(configData);
            }
        };
    }, []);

    return (
        <Box sx={{ p: 2, background: '#f5f5f5', borderRadius: 2 }}>
            <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                style={{ display: 'none' }} 
                accept=".xml" 
            />

            <Typography variant="h6" gutterBottom>Channel Definitions</Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mb: 0 }}>Prototypes</Typography>
                <Tooltip title={helpText.headings.prototypes} placement="right">
                    <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
                </Tooltip>
            </Box>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs value={activePrototype} onChange={(e, nv) => setActivePrototype(nv)} variant="scrollable" scrollButtons="auto" aria-label="Channel Prototypes">
                    {prototypes.map((p, i) => <Tab key={i} label={p.name || `Proto ${i + 1}`} />)}
                    <IconButton onClick={addPrototype} sx={{ alignSelf: 'center', ml: '10px' }}><AddIcon /></IconButton>
                </Tabs>
            </Box>
            {prototypes[activePrototype] && (
                <Box sx={{ mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: '4px' }}>
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                            <HelpField id="type" label="Type" value={prototypes[activePrototype].type} onChange={(id,v) => updatePrototype(activePrototype, id, v)} helptext={helpText.prototypes.type} select>
                                {prototypeTypeOptions.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                            </HelpField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <HelpField id="name" label="Prototype Name" value={prototypes[activePrototype].name} onChange={(id,v) => setCustomPrototypeName(activePrototype, v)} helptext={helpText.prototypes.name} required />
                        </Grid>
                        
                        {prototypes[activePrototype].type === 'File' && (
                           <Grid item xs={12}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                                    <TextField 
                                        fullWidth 
                                        size="small" 
                                        label="Source File (NeuroML)" 
                                        variant="outlined"
                                        value={prototypes[activePrototype].file} 
                                        InputProps={{ readOnly: true }}
                                        helperText="Click button to select file"
                                    />
                                    <Button 
                                        variant="outlined" 
                                        size="small" 
                                        onClick={handleFileSelect}
                                        startIcon={<UploadFileIcon />}
                                        sx={{ flexShrink: 0, height: '40px' }}
                                    >
                                        Select...
                                    </Button>
                                    <Tooltip title={helpText.prototypes.file} placement="right">
                                        <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
                                    </Tooltip>
                                </Box>
                            </Grid>
                        )}
                    </Grid>
                    <Button variant="outlined" color="secondary" startIcon={<DeleteIcon />} onClick={() => removePrototype(activePrototype)} sx={{ mt: 2 }}>
                        Remove '{prototypes[activePrototype].name}'
                    </Button>
                </Box>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', mt: 3 }}>
                 <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mb: 0 }}>Distributions</Typography>
                 <Tooltip title={helpText.headings.distributions} placement="right">
                    <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
                 </Tooltip>
            </Box>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                 <Tabs value={activeDistribution} onChange={(e, nv) => setActiveDistribution(nv)} variant="scrollable" scrollButtons="auto" aria-label="Channel Distributions">
                     {distributions.map((d, i) => <Tab key={i} label={`${d.prototype || 'New'} @ ${d.path || '?'}`} />)}
                     <IconButton onClick={addDistribution} sx={{ alignSelf: 'center', ml: '10px' }}><AddIcon /></IconButton>
                 </Tabs>
            </Box>
            {distributions[activeDistribution] && (
                 <Box sx={{ mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: '4px' }}>
                     <Grid container spacing={2}>
                        {/* 1. Moved Path to first position, full width, and made into a Menu */}
                        <Grid item xs={12}>
                             <HelpField 
                                id="path" 
                                label="Parent Elec Compartment" 
                                select
                                value={distributions[activeDistribution].path} 
                                onChange={(id,v) => handlePathChange(activeDistribution, v)} 
                                helptext={helpText.distributions.path}
                             >
                                {distributions[activeDistribution].path &&
                                 !pathOptions.includes(distributions[activeDistribution].path) &&
                                 distributions[activeDistribution].path !== OPTION_USER_SPECIFIED && (
                                    <MenuItem key="__current__" value={distributions[activeDistribution].path}>{distributions[activeDistribution].path}</MenuItem>
                                )}
                                {pathOptions.map(opt => (
                                    <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                                ))}
                             </HelpField>
                        </Grid>

                        <Grid item xs={12} sm={6}>
                             <HelpField id="prototype" label="Prototype" select required value={distributions[activeDistribution].prototype} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.prototype}>
                                <MenuItem value=""><em>Select...</em></MenuItem>
                                {prototypes.filter(p => p.name).map((p) => <MenuItem key={p.name} value={p.name}>{p.name}</MenuItem>)}
                            </HelpField>
                         </Grid>
                         <Grid item xs={12} sm={6}>
                             {prototypes.find(p => p.name === distributions[activeDistribution].prototype)?.type === 'Ca_conc' ? (
                                 <HelpField id="caTau" label="Ca Tau (s)" type="number" required value={distributions[activeDistribution].caTau} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.caTau} />
                             ) : (
                                 <HelpField id="maxConductance" label="Gbar (Max Conductance)" type="number" required value={distributions[activeDistribution].maxConductance} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.maxConductance} />
                             )}
                        </Grid>
                    </Grid>
                    <Button variant="outlined" color="secondary" startIcon={<DeleteIcon />} onClick={() => removeDistribution(activeDistribution)} sx={{ mt: 2 }}>
                         Remove Distribution
                     </Button>
                </Box>
             )}

            {/* Custom Path Dialog */}
            <Dialog open={customPathDialogOpen} onClose={() => setCustomPathDialogOpen(false)}>
                <DialogTitle>Enter User Specified Path</DialogTitle>
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

export default ElecMenuBox;
