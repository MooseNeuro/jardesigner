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
import RefreshIcon from '@mui/icons-material/Refresh';
import helpText from './ChemMenuBox.Help.json';
import { formatFloat } from '../../utils/formatters.js';
import { getCompartmentOptions, OPTION_USER_SPECIFIED } from '../../utils/menuHelpers';

// --- Helper Functions ---
const getChemSourceString = (componentType) => {
    switch (componentType) {
        case 'Oscillator': return 'makeChemOscillator()';
        case 'Bistable':   return 'makeChemBistable()';
        case 'CaDend':   return 'makeChemCaDend()';
        case 'CaSpineDend':   return 'makeChemCaSpineDend()';
        case 'LTP':        return 'makeChemLTP()';
        case 'LTD':        return 'makeChemLTD()';
        case 'STF':        return 'makeChemSTF()';
        case 'STD':        return 'makeChemSTD()';
        case 'BCM':        return 'makeChemBCM()';
        case 'betaAR':     return 'makeChemBetaAR()';
        case 'mGluR':      return 'makeChem_mGluR()';
        case 'EGFR':       return 'makeChemEGFR()';
        case 'CaMKII':     return 'makeChemCaMKII()';
        case 'CICR':       return 'makeChemCICR()';
        default:           return componentType;
    }
};

const getComponentTypeFromSchema = (schemaType, schemaSource) => {
    if (schemaType === 'sbml') return 'SBML';
    if (schemaType === 'kkit') return 'kkit';
    if (schemaType === 'in_memory') return 'In-memory';
    const options = prototypeTypeOptions.filter(opt => !['SBML', 'kkit', 'User Func', 'In-memory'].includes(opt));
    const match = options.find(opt => getChemSourceString(opt) === schemaSource || opt === schemaSource);
    if (match) return match;
    if (schemaSource && schemaSource.includes('Func')) return 'User Func';
    return schemaSource || 'Unknown';
};

const prototypeTypeOptions = [
    'Oscillator', 'Bistable', 'CaDend', 'CaSpineDend', 'LTP', 'LTD', 'STF', 'STD', 'BCM', 'betaAR', 
	'mGluR', 'EGFR', 'CaMKII', 'CICR',
    'SBML', 'kkit', 'User Func', 'In-memory'
];

const locationOptions = [
    'Dendrite', 'Spine', 'PSD', 'Endo', 'Presyn_spine', 'Presyn_dend'
];

// --- Default State Creators ---
const createDefaultChemPrototype = () => ({
    type: prototypeTypeOptions[0],
    name: prototypeTypeOptions[0],
    source: '',
    manualName: false,
});

const createDefaultChemDistribution = () => ({
    prototype: '',
    location: locationOptions[0],
    path: 'soma', // Default path
    diffusionLength_um: '500', // Default diffusion length
    parent: '',
    radius_um: '',
    radiusSdev_um: '',
    spacing_um: '',
    radiusRatio: '',
    radiusByPsd: '',
    radiusByPsdSdev: '',
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
const ChemMenuBox = ({ 
    onConfigurationChange, 
    currentConfig, 
    clientId, 
    meshMols,
    elecPaths = [],
    spinePaths = []
}) => {
	console.log("ChemMenuBox rendered. meshMols prop:", meshMols);
    const [prototypes, setPrototypes] = useState(() => {
        const initialProtos = currentConfig?.chemProto?.map(p => {
            const componentType = getComponentTypeFromSchema(p.type, p.source);
            let sourceValue = '';
            if (['SBML', 'kkit', 'User Func', 'In-memory'].includes(componentType)) {
                sourceValue = p.source || '';
            }
            return {
                type: componentType,
                name: p.name,
                source: sourceValue,
                manualName: p.name !== componentType,
            };
        }) || [];
        return initialProtos.length > 0 ? initialProtos : [createDefaultChemPrototype()];
    });

    const [distributions, setDistributions] = useState(() => {
        const mapSchemaDistribTypeToLocation = (type) => {
            switch(type) {
                case 'dend': return 'Dendrite';
                case 'spine': return 'Spine';
                case 'psd': return 'PSD';
                case 'endo': return 'Endo';
                case 'presyn_spine': return 'Presyn_spine';
                case 'presyn_dend': return 'Presyn_dend';
                default: return 'Dendrite';
            }
        };
        const initialDists = currentConfig?.chemDistrib?.map(d => {
            const baseDist = {
                ...createDefaultChemDistribution(),
                prototype: d.proto,
                location: mapSchemaDistribTypeToLocation(d.type),
                path: d.path,
            };

            switch (d.type) {
                case 'dend':
                    if (d.diffusionLength !== undefined) baseDist.diffusionLength_um = formatFloat(Number(d.diffusionLength) * 1e6);
                    break;
                case 'spine':
                case 'psd':
                    if (d.parent !== undefined) baseDist.parent = d.parent;
                    break;
                case 'endo':
                     if (d.parent !== undefined) baseDist.parent = d.parent;
                     if (d.radiusRatio !== undefined) baseDist.radiusRatio = String(d.radiusRatio);
                     if (d.spacing !== undefined) baseDist.spacing_um = formatFloat(Number(d.spacing) * 1e6);
                    break;
                case 'presyn_spine':
                    if (d.radiusByPsd !== undefined) baseDist.radiusByPsd = String(d.radiusByPsd);
                    if (d.radiusByPsdSdev !== undefined) baseDist.radiusByPsdSdev = String(d.radiusByPsdSdev);
                    break;
                case 'presyn_dend':
                    if (d.radius !== undefined) baseDist.radius_um = formatFloat(Number(d.radius) * 1e6);
                    if (d.radiusSdev !== undefined) baseDist.radiusSdev_um = formatFloat(Number(d.radiusSdev) * 1e6);
                    if (d.spacing !== undefined) baseDist.spacing_um = formatFloat(Number(d.spacing) * 1e6);
                    break;
                default:
                    break;
            }
            return baseDist;
        }) || [];
        return initialDists.length > 0 ? initialDists : [createDefaultChemDistribution()];
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

    // Create sorted list of chem compartment (mesh) names
    const chemCompartmentOptions = useMemo(() => {
        if (!meshMols || typeof meshMols !== 'object') return [];
        return Object.keys(meshMols).sort();
    }, [meshMols]);

    // --- Helper to generate path options ---
    const pathOptions = useMemo(() => {
        const allPaths = [...elecPaths, ...spinePaths];
        const opts = getCompartmentOptions(allPaths);
        
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
        setPrototypes((prev) => [...prev, createDefaultChemPrototype()]);
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
                    if (key === 'type' && !['SBML', 'kkit', 'User Func', 'In-memory'].includes(value)) {
                         updatedProto.source = '';
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
            
            updatePrototype(activePrototype, 'source', file.name);
            
        } catch (error) {
            console.error("Error uploading chem file:", error);
            alert(`Failed to upload the selected file: ${error.message}`);
        }
    };

    const addDistribution = useCallback(() => {
        setDistributions((prev) => [...prev, createDefaultChemDistribution()]);
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


    // --- Refactored Save/Refresh Logic ---
    const getChemDataForSave = useCallback(() => {
        const currentPrototypes = prototypesRef.current;
        const currentDistributions = distributionsRef.current;

        const chemProtoData = currentPrototypes.map(protoState => {
            let schemaType = "builtin";
            let schemaSource = "";
            const componentType = protoState.type;

            if (componentType === 'SBML') { schemaType = 'sbml'; schemaSource = protoState.source; }
            else if (componentType === 'kkit') { schemaType = 'kkit'; schemaSource = protoState.source; }
            else if (componentType === 'In-memory') { schemaType = 'in_memory'; schemaSource = protoState.source; }
            else if (componentType === 'User Func') {
                schemaType = 'builtin';
                schemaSource = protoState.source || protoState.name;
            } else {
                schemaType = 'builtin';
                schemaSource = getChemSourceString(componentType);
            }

            if (!protoState.name || !schemaSource) return null;
            return { type: schemaType, source: schemaSource, name: protoState.name };
        }).filter(p => p !== null);

        const chemDistribData = currentDistributions.map(distState => {
            if (!distState.prototype || !distState.path) return null;

            const baseDistrib = {
                proto: distState.prototype,
                path: distState.path,
            };
            
            const umToSI = (um_val) => {
                if (um_val === undefined || um_val === null || String(um_val).trim() === '') return undefined;
                const num = parseFloat(um_val);
                return isNaN(num) ? undefined : num * 1e-6;
            };

            const parseFloatOrUndefined = (val) => {
                    if (val === undefined || val === null || String(val).trim() === '') return undefined;
                    const num = parseFloat(val);
                    return isNaN(num) ? undefined : num;
            }

            switch(distState.location) {
                case 'Dendrite':
                    baseDistrib.type = 'dend';
                    const diffLen = umToSI(distState.diffusionLength_um);
                    if (diffLen !== undefined) baseDistrib.diffusionLength = diffLen;
                    break;
                case 'Spine':
                    baseDistrib.type = 'spine';
                    if (distState.parent) baseDistrib.parent = distState.parent;
                    break;
                case 'PSD':
                    baseDistrib.type = 'psd';
                    if (distState.parent) baseDistrib.parent = distState.parent;
                    break;
                case 'Endo':
                    baseDistrib.type = 'endo';
                    if (distState.parent) baseDistrib.parent = distState.parent;
                    const radiusRatio = parseFloatOrUndefined(distState.radiusRatio);
                    if (radiusRatio !== undefined) baseDistrib.radiusRatio = radiusRatio;
                    const endoSpacing = umToSI(distState.spacing_um);
                    if (endoSpacing !== undefined) baseDistrib.spacing = endoSpacing;
                    break;
                case 'Presyn_spine':
                    baseDistrib.type = 'presyn_spine';
                    const radiusByPsd = parseFloatOrUndefined(distState.radiusByPsd);
                    if (radiusByPsd !== undefined) baseDistrib.radiusByPsd = radiusByPsd;
                    const radiusByPsdSdev = parseFloatOrUndefined(distState.radiusByPsdSdev);
                    if (radiusByPsdSdev !== undefined) baseDistrib.radiusByPsdSdev = radiusByPsdSdev;
                    break;
                case 'Presyn_dend':
                    baseDistrib.type = 'presyn_dend';
                    const pdRadius = umToSI(distState.radius_um);
                    if (pdRadius !== undefined) baseDistrib.radius = pdRadius;
                    const pdRadiusSdev = umToSI(distState.radiusSdev_um);
                    if (pdRadiusSdev !== undefined) baseDistrib.radiusSdev = pdRadiusSdev;
                    const pdSpacing = umToSI(distState.spacing_um);
                    if (pdSpacing !== undefined) baseDistrib.spacing = pdSpacing;
                    break;
                default:
                    return null; 
            }

            return baseDistrib;
        }).filter(item => item !== null);

        return { chemProto: chemProtoData, chemDistrib: chemDistribData };
    }, []);

    const handleRefreshModel = useCallback(() => {
        if (onConfigurationChangeRef.current) {
            const configData = getChemDataForSave();
            onConfigurationChangeRef.current(configData);
        }
    }, [getChemDataForSave]);

    useEffect(() => {
        return () => {
            handleRefreshModel();
        };
    }, [handleRefreshModel]);
    
    const activeProtoData = prototypes[activePrototype];
    const activeDistribData = distributions[activeDistribution];

    return (
        <Box sx={{ p: 2, background: '#f5f5f5', borderRadius: 2 }}>
            <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                style={{ display: 'none' }} 
                accept=".xml,.g" 
            />

            <Typography variant="h6" gutterBottom>Chemical Signaling Definitions</Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mb: 0 }}>Prototypes</Typography>
                <Tooltip title={helpText.headings.prototypes} placement="right"><IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={handleRefreshModel} sx={{ ml: 'auto' }}>
                    Refresh Model
                </Button>
            </Box>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs value={activePrototype} onChange={(e, nv) => setActivePrototype(nv)} variant="scrollable" scrollButtons="auto">
                    {prototypes.map((p, i) => <Tab key={i} label={p.name || `Proto ${i + 1}`} />)}
                    <IconButton onClick={addPrototype} sx={{ alignSelf: 'center', ml: '10px' }}><AddIcon /></IconButton>
                </Tabs>
            </Box>
            {activeProtoData && (
                <Box sx={{ mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: '4px' }}>
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                             <HelpField id="type" label="Type" value={activeProtoData.type} onChange={(id,v) => updatePrototype(activePrototype, id, v)} helptext={helpText.prototypes.type} select>
                                {prototypeTypeOptions.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                            </HelpField>
                        </Grid>
                         <Grid item xs={12} sm={6}>
                            <HelpField id="name" label="Prototype Name" value={activeProtoData.name} onChange={(id,v) => setCustomPrototypeName(activePrototype, v)} helptext={helpText.prototypes.name} required/>
                         </Grid>
                         
                         {['SBML', 'kkit'].includes(activeProtoData.type) && (
                            <Grid item xs={12}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <TextField 
                                        fullWidth 
                                        size="small" 
                                        label="Source File" 
                                        variant="outlined"
                                        value={activeProtoData.source} 
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
                                    <Tooltip title={helpText.prototypes.source} placement="right">
                                        <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
                                    </Tooltip>
                                </Box>
                            </Grid>
                        )}

                         {['User Func', 'In-memory'].includes(activeProtoData.type) && (
                            <Grid item xs={12}>
                                <HelpField id="source" label="Source" value={activeProtoData.source} onChange={(id,v) => updatePrototype(activePrototype, id, v)} helptext={helpText.prototypes.source} required />
                            </Grid>
                        )}
                    </Grid>
                     <Button variant="outlined" color="secondary" startIcon={<DeleteIcon />} onClick={() => removePrototype(activePrototype)} sx={{ mt: 2 }}>
                        Remove '{activeProtoData.name}'
                    </Button>
                </Box>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', mt: 3 }}>
                <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mb: 0 }}>Distributions</Typography>
                <Tooltip title={helpText.headings.distributions} placement="right"><IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton></Tooltip>
            </Box>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                 <Tabs value={activeDistribution} onChange={(e, nv) => setActiveDistribution(nv)} variant="scrollable" scrollButtons="auto">
                     {distributions.map((d, i) => <Tab key={i} label={`${d.prototype || 'New'} @ ${d.path || '?'}`} />)}
                     <IconButton onClick={addDistribution} sx={{ alignSelf: 'center', ml: '10px' }}><AddIcon /></IconButton>
                 </Tabs>
             </Box>
            {activeDistribData && (
                <Box sx={{ mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: '4px' }}>
                     <Grid container spacing={2}>
                         {/* Row 1: Parent Elec Compartment (Full Width, Menu) */}
                         <Grid item xs={12}>
                             <HelpField 
                                id="path" 
                                label="Parent Elec Compartment" 
                                select
                                value={activeDistribData.path} 
                                onChange={(id,v) => handlePathChange(activeDistribution, v)} 
                                helptext={helpText.distributions.path}
                             >
                                {activeDistribData.path &&
                                 !pathOptions.includes(activeDistribData.path) &&
                                 activeDistribData.path !== OPTION_USER_SPECIFIED && (
                                    <MenuItem key="__current__" value={activeDistribData.path}>{activeDistribData.path}</MenuItem>
                                )}
                                {pathOptions.map(opt => (
                                    <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                                ))}
                             </HelpField>
                         </Grid>

                         {/* Row 2: Type of chemical compartment (Full Width) */}
                         <Grid item xs={12}>
                              <HelpField id="location" label="Type of chemical compartment" select required value={activeDistribData.location} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.location}>
                                 {locationOptions.map(loc => (
                                     <MenuItem key={loc} value={loc}>
                                         {loc === 'Endo' ? 'Endosome' : loc}
                                     </MenuItem>
                                 ))}
                             </HelpField>
                          </Grid>
                         
                         {/* Row 3: Chem Compartment and Diffusion Length */}
                         <Grid item xs={12} sm={6}>
                             <HelpField id="prototype" label="Chem Compartment" select required value={activeDistribData.prototype} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.prototype}>
                                <MenuItem value=""><em>Select...</em></MenuItem>
                                {chemCompartmentOptions.map((meshName) => <MenuItem key={meshName} value={meshName}>{meshName}</MenuItem>)}
                            </HelpField>
                         </Grid>
                         {activeDistribData.location === 'Dendrite' && (
                             <Grid item xs={12} sm={6}>
                                 <HelpField id="diffusionLength_um" label="Diffusion Length (μm)" type="number" value={activeDistribData.diffusionLength_um} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.diffusionLength} />
                             </Grid>
                         )}

                         {/* --- Location-Specific Fields --- */}

                         {(activeDistribData.location === 'Spine' || activeDistribData.location === 'PSD') && (
                             <Grid item xs={12} sm={6}>
                                 <HelpField id="parent" label="Parent" value={activeDistribData.parent} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.parent} />
                             </Grid>
                         )}

                         {activeDistribData.location === 'Endo' && (
                             <>
                                 <Grid item xs={12} sm={6}>
                                     <HelpField id="parent" label="Parent" value={activeDistribData.parent} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.parent} />
                                 </Grid>
                                 <Grid item xs={12} sm={6}>
                                     <HelpField id="radiusRatio" label="Radius Ratio" type="number" value={activeDistribData.radiusRatio} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.radiusRatio} />
                                 </Grid>
                                  <Grid item xs={12} sm={6}>
                                     <HelpField id="spacing_um" label="Spacing (μm)" type="number" value={activeDistribData.spacing_um} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.spacing} />
                                 </Grid>
                             </>
                         )}

                         {activeDistribData.location === 'Presyn_spine' && (
                             <>
                                 <Grid item xs={12} sm={6}>
                                     <HelpField id="radiusByPsd" label="Radius by PSD" type="number" value={activeDistribData.radiusByPsd} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.radiusByPsd} />
                                 </Grid>
                                 <Grid item xs={12} sm={6}>
                                     <HelpField id="radiusByPsdSdev" label="Radius by PSD Sdev" type="number" value={activeDistribData.radiusByPsdSdev} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.radiusByPsdSdev} />
                                 </Grid>
                             </>
                         )}

                         {activeDistribData.location === 'Presyn_dend' && (
                             <>
                                 <Grid item xs={12} sm={6}>
                                     <HelpField id="radius_um" label="Radius (μm)" type="number" value={activeDistribData.radius_um} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.radius} />
                                 </Grid>
                                 <Grid item xs={12} sm={6}>
                                     <HelpField id="radiusSdev_um" label="Radius Sdev (μm)" type="number" value={activeDistribData.radiusSdev_um} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.radiusSdev} />
                                 </Grid>
                                 <Grid item xs={12} sm={6}>
                                     <HelpField id="spacing_um" label="Spacing (μm)" type="number" value={activeDistribData.spacing_um} onChange={(id,v) => updateDistribution(activeDistribution, id, v)} helptext={helpText.distributions.spacing} />
                                 </Grid>
                             </>
                         )}
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

export default ChemMenuBox;
