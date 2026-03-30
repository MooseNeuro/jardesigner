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
    Divider,
    Checkbox,
    FormControlLabel,
    Tooltip,
    ListSubheader,
    FormHelperText,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import helpText from './ThreeDMenuBox.Help.json';
import { formatFloat } from '../../utils/formatters.js';
import { getCompartmentOptions, OPTION_USER_SPECIFIED } from '../../utils/menuHelpers';

// --- Define options outside component ---
const nonChemFieldOptions = [
    'Vm', 'Im', 'inject', 'Gbar', 'Gk', 'Ik', 'ICa', 'Cm', 'Rm', 'Ra',
    'Ca', 'activation', 'current', 'modulation', 'psdArea'
];
const chemFieldOptions = ['n', 'conc', 'concInit', 'nInit'];
const chemFields = [...chemFieldOptions];
const fastDtFields = ['Vm', 'Im', 'inject', 'Gbar', 'Gk', 'Ik', 'ICa', 'activation', 'current', 'Ca'];
const colormapOptions = ['viridis', 'plasma', 'inferno', 'magma', 'cividis', 'jet', 'gray', 'cool', 'hot', 'bwr'];
const backgroundOptions = ['default', 'white', 'black', 'grey', 'beige'];

// --- Helper to safely convert value to string ---
const safeToString = (value, defaultValue = '') => {
    return value !== undefined && value !== null ? String(value) : defaultValue;
};

// --- Default state creators ---
const createDefaultMoogliEntry = () => ({
    path: '#', // Default to # per request
    field: nonChemFieldOptions[0],
    chemProto: '.',
    childPath: '',
    title: '',
    diameterScale: '1.0',
    min: '0',
    max: '0',
    dt: '0.001',
});

const createDefaultGlobalSettings = () => ({
    rotation: '0.0',
    azimuth: '0.0',
    elevation: '0.0',
    mergeDisplays: false,
    fullScreen: false,
    colormap: 'jet',
    background: 'default',
    center: '[0,0,0]',
    block: true,
});

// --- Reusable HelpField Component ---
const HelpField = React.memo(({ id, label, value, onChange, type = "text", fullWidth = true, ...props }) => {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <TextField {...props} fullWidth={fullWidth} size="small" label={label} variant="outlined" type={type}
                value={value} onChange={(e) => onChange(id, e.target.value)} />
            <Tooltip title={props.helptext} placement="right">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
            </Tooltip>
        </Box>
    );
});


// --- Main Component ---
const ThreeDMenuBox = ({ 
    onConfigurationChange, 
    currentConfig, 
    meshMols,
    elecPaths = [], 
    spinePaths = [],
    channelPrototypes = [] 
}) => {
    const [tabs, setTabs] = useState(() => {
        const defaults = createDefaultMoogliEntry();
        const initialTabs = currentConfig?.moogli?.map(m => {
            const field = m.field || nonChemFieldOptions[0];
            const isChemField = chemFields.includes(field);
            let initialChemProto = '.';
            let initialChildPath = '';
            if (isChemField) {
                const relpath = m.relpath || '';
                const slashIndex = relpath.indexOf('/');
                if (slashIndex !== -1) {
                    initialChemProto = relpath.substring(0, slashIndex);
                    initialChildPath = relpath.substring(slashIndex + 1);
                } else {
                    initialChemProto = '';
                    initialChildPath = relpath;
                }
            } else {
                initialChildPath = m.relpath || '';
            }
            return {
                path: m.path || defaults.path,
                field: field,
                chemProto: initialChemProto,
                childPath: initialChildPath,
                title: m.title || '',
                diameterScale: formatFloat(m.diaScale) || defaults.diameterScale,
                min: formatFloat(m.ymin) || defaults.min,
                max: formatFloat(m.ymax) || defaults.max,
                dt: formatFloat(m.dt) || (fastDtFields.includes(field) ? '0.001' : '0.2'),
            };
        }) || [];
        return initialTabs.length > 0 ? initialTabs : [createDefaultMoogliEntry()];
    });

    const [globalSettings, setGlobalSettings] = useState(() => {
        const initialDisplay = currentConfig?.displayMoogli || {};
        const defaults = createDefaultGlobalSettings();
        return {
            rotation: formatFloat(initialDisplay.rotation) || defaults.rotation,
            azimuth: formatFloat(initialDisplay.azim) || defaults.azimuth,
            elevation: formatFloat(initialDisplay.elev) || defaults.elevation,
            mergeDisplays: initialDisplay.mergeDisplays ?? defaults.mergeDisplays,
            fullScreen: initialDisplay.fullscreen ?? defaults.fullScreen,
            colormap: initialDisplay.colormap || defaults.colormap,
            background: backgroundOptions.includes(initialDisplay.bg) ? initialDisplay.bg : defaults.background,
            center: JSON.stringify(initialDisplay.center || JSON.parse(defaults.center)),
            block: initialDisplay.block ?? defaults.block,
        };
    });

    const [activeTab, setActiveTab] = useState(0);

    // --- Dialog State ---
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogField, setDialogField] = useState(''); // 'path' or 'childPath'
    const [tempDialogValue, setTempDialogValue] = useState('');

    const onConfigurationChangeRef = useRef(onConfigurationChange);
    useEffect(() => { onConfigurationChangeRef.current = onConfigurationChange; }, [onConfigurationChange]);
    const tabsRef = useRef(tabs);
    useEffect(() => { tabsRef.current = tabs; }, [tabs]);
    const globalSettingsRef = useRef(globalSettings);
    useEffect(() => { globalSettingsRef.current = globalSettings; }, [globalSettings]);

    const addTab = useCallback(() => {
        setTabs((prev) => [...prev, createDefaultMoogliEntry()]);
        setActiveTab(tabsRef.current.length);
    }, []);

    const removeTab = useCallback((indexToRemove) => {
        setTabs((prev) => prev.filter((_, i) => i !== indexToRemove));
        setActiveTab((prev) => Math.max(0, prev - (prev >= indexToRemove ? 1 : 0)));
    }, []);

    const updateTab = useCallback((index, key, value) => {
        setTabs((prevTabs) =>
            prevTabs.map((tab, i) => {
                if (i === index) {
                    const updatedTab = { ...tab, [key]: value };
                    
                    if (key === 'field') {
                        const isNowChem = chemFields.includes(value);
                        const wasChem = chemFields.includes(tab.field);
                        if (wasChem && !isNowChem) {
                            updatedTab.chemProto = '.';
                            updatedTab.childPath = '';
                        } else if (!wasChem && isNowChem) {
                            updatedTab.chemProto = '';
                            updatedTab.childPath = '';
                        }
                        updatedTab.dt = fastDtFields.includes(value) ? '0.001' : '0.2';
                    }

                    if (key === 'chemProto') {
                        updatedTab.childPath = ''; 
                    }

                    return updatedTab;
                }
                return tab;
            })
        );
    }, []);

    const updateGlobalSetting = useCallback((key, value) => {
        const actualValue = (typeof value === 'boolean') ? value : value;
        setGlobalSettings((prev) => ({ ...prev, [key]: actualValue }));
    }, []);

    const handleTabChange = (event, newValue) => setActiveTab(newValue);

    // --- Dialog Handlers ---
    const handleOpenDialog = (field) => {
        setDialogField(field);
        setTempDialogValue('');
        setDialogOpen(true);
    };

    const handleSaveDialog = () => {
        if (tempDialogValue.trim() !== '') {
            updateTab(activeTab, dialogField, tempDialogValue.trim());
        }
        setDialogOpen(false);
    };

    const handlePathChange = (e) => {
        const val = e.target.value;
        if (val === OPTION_USER_SPECIFIED) {
            handleOpenDialog('path');
        } else {
            updateTab(activeTab, 'path', val);
        }
    };

    const handleChildPathChange = (e) => {
        const val = e.target.value;
        if (val === OPTION_USER_SPECIFIED) {
            handleOpenDialog('childPath');
        } else {
            updateTab(activeTab, 'childPath', val);
        }
    };

    // --- Options Generation ---
    const pathOptions = useMemo(() => {
        const allPaths = [...elecPaths, ...spinePaths];
        const opts = getCompartmentOptions(allPaths);
        // Ensure '#' is present as the default/root option
        if (!opts.includes('#')) {
            opts.unshift('#');
        }
        return opts;
    }, [elecPaths, spinePaths]);

    const chemCompartmentOptions = useMemo(() => {
        if (!meshMols || typeof meshMols !== 'object') return [];
        return Object.keys(meshMols).sort();
    }, [meshMols]);

    const activeTabData = tabs[activeTab];
    const isChemField = activeTabData && chemFields.includes(activeTabData.field);

    const moleculeOptions = useMemo(() => {
        if (!isChemField || !meshMols || !activeTabData.chemProto) return [];
        const mols = meshMols[activeTabData.chemProto];
        return Array.isArray(mols) ? [...mols].sort() : [];
    }, [isChemField, meshMols, activeTabData?.chemProto]);


    // --- Refactored Save/Refresh Logic ---
    const getThreeDDataForSave = useCallback(() => {
        const moogliData = tabsRef.current.map(tabState => {
            if (!tabState.path || !tabState.field) return null;
            const diaScaleNum = parseFloat(tabState.diameterScale);
            const minNum = parseFloat(tabState.min);
            const maxNum = parseFloat(tabState.max);
            const dtNum = parseFloat(tabState.dt);
            const defaultsMoogli = createDefaultMoogliEntry();
            const isChemField = chemFields.includes(tabState.field);
            let relpathValue = undefined;

            if (isChemField) {
                if (tabState.chemProto && tabState.childPath) {
                    relpathValue = `${tabState.chemProto}/${tabState.childPath}`;
                } else { return null; }
            } else {
                if (tabState.childPath && tabState.childPath !== '') relpathValue = tabState.childPath;
            }

            const moogliSchemaItem = { path: tabState.path, field: tabState.field };
            if (relpathValue !== undefined) moogliSchemaItem.relpath = relpathValue;
            if (tabState.title) moogliSchemaItem.title = tabState.title;
            if (!isNaN(diaScaleNum) && safeToString(diaScaleNum) !== defaultsMoogli.diameterScale) moogliSchemaItem.diaScale = diaScaleNum;
            if (!isNaN(minNum) && safeToString(minNum) !== defaultsMoogli.min) moogliSchemaItem.ymin = minNum;
            if (!isNaN(maxNum) && safeToString(maxNum) !== defaultsMoogli.max) moogliSchemaItem.ymax = maxNum;
            if (!isNaN(dtNum)) moogliSchemaItem.dt = dtNum;

            return moogliSchemaItem;

        }).filter(item => item !== null);

        if (moogliData.length === 0) {
            return { moogli: [], displayMoogli: undefined };
        }

        let centerArray;
        try {
            const parsedCenter = JSON.parse(globalSettingsRef.current.center);
            centerArray = (Array.isArray(parsedCenter) && parsedCenter.length === 3 && parsedCenter.every(n => typeof n === 'number')) ? parsedCenter : JSON.parse(createDefaultGlobalSettings().center);
        } catch (e) {
            centerArray = JSON.parse(createDefaultGlobalSettings().center);
        }
        const defaultsGlobal = createDefaultGlobalSettings();
        const displayMoogliData = {
            rotation: parseFloat(globalSettingsRef.current.rotation) || parseFloat(defaultsGlobal.rotation),
            azim: parseFloat(globalSettingsRef.current.azimuth) || parseFloat(defaultsGlobal.azimuth),
            elev: parseFloat(globalSettingsRef.current.elevation) || parseFloat(defaultsGlobal.elevation),
            colormap: globalSettingsRef.current.colormap || defaultsGlobal.colormap,
            bg: globalSettingsRef.current.background || defaultsGlobal.background,
            center: centerArray,
            block: globalSettingsRef.current.block,
            ...(globalSettingsRef.current.mergeDisplays !== defaultsGlobal.mergeDisplays && { mergeDisplays: globalSettingsRef.current.mergeDisplays }),
            ...(globalSettingsRef.current.fullScreen !== defaultsGlobal.fullScreen && { fullscreen: globalSettingsRef.current.fullScreen }),
        };
        return { moogli: moogliData, displayMoogli: displayMoogliData };
    }, []); 

    const handleRefreshModel = useCallback(() => {
        if (onConfigurationChangeRef.current) {
            const configData = getThreeDDataForSave();
            onConfigurationChangeRef.current(configData);
        }
    }, [getThreeDDataForSave]);

    useEffect(() => {
        return () => {
            handleRefreshModel();
        };
    }, [handleRefreshModel]);

    const getTabLabel = (tab) => {
        const isChem = chemFields.includes(tab.field);
        if (isChem) {
            const mol = tab.childPath || '?';
            const comp = tab.chemProto || '?';
            return `${mol}@${comp}`;
        }
        return `${tab.field || 'New'} @ ${tab.path || '?'}`;
    };
    
    const showChemCompartmentWarning = isChemField && !chemCompartmentOptions.length;

    return (
        <Box sx={{ p: 2, background: '#f5f5f5', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="h6" gutterBottom sx={{ mb: 0 }}>3D Visualization (Moogli)</Typography>
                <Tooltip title={helpText.main} placement="right"><IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton></Tooltip>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mb: 0 }}>Data Sources</Typography>
                <Tooltip title={helpText.headings.dataSources} placement="right"><IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={handleRefreshModel} sx={{ ml: 'auto' }}>
                    Refresh Model
                </Button>
            </Box>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
                    {tabs.map((tab, index) => <Tab key={index} label={getTabLabel(tab)} />)}
                    <IconButton onClick={addTab} sx={{ alignSelf: 'center', ml: '10px' }}><AddIcon /></IconButton>
                </Tabs>
            </Box>
            {activeTabData && (
                <Box sx={{ mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: '4px' }}>
                    <Grid container spacing={2}>
                        {/* 1. Parent Elec Compartment: First entry, Full Width */}
                        <Grid item xs={12}>
                             <HelpField 
                                id="path" 
                                label="Parent Elec Compartment" 
                                select
                                required 
                                value={activeTabData.path} 
                                onChange={(id, v) => handlePathChange({ target: { value: v } })} 
                                helptext={helpText.dataSources.path}
                             >
                                {activeTabData.path &&
                                 !pathOptions.includes(activeTabData.path) &&
                                 activeTabData.path !== OPTION_USER_SPECIFIED && (
                                    <MenuItem key="__current__" value={activeTabData.path}>{activeTabData.path}</MenuItem>
                                )}
                                {pathOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                             </HelpField>
                        </Grid>

                        <Grid item xs={12} sm={6}>
                            <HelpField id="field" label="Field" required select value={activeTabData.field} onChange={(id, v) => updateTab(activeTab, id, v)} helptext={helpText.dataSources.field}>
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
                                value={activeTabData.chemProto} 
                                onChange={(id, v) => updateTab(activeTab, id, v)} 
                                helptext={helpText.dataSources.chemProto} 
                                error={isChemField && (showChemCompartmentWarning || !activeTabData.chemProto)}
                                disabled={!isChemField}
                            >
                                <MenuItem value={isChemField ? "" : "."}><em>{isChemField ? "Select..." : "."}</em></MenuItem>
                                {chemCompartmentOptions.map(compName => <MenuItem key={compName} value={compName}>{compName}</MenuItem>)}
                            </HelpField>
                            {isChemField && (showChemCompartmentWarning || !activeTabData.chemProto) && 
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
                                        value={activeTabData.childPath} 
                                        onChange={(id, v) => updateTab(activeTab, id, v)} 
                                        helptext={helpText.dataSources.childPath} 
                                        error={!activeTabData.childPath}
                                        disabled={!activeTabData.chemProto}
                                    >
                                        <MenuItem value=""><em>{activeTabData.chemProto ? "Select..." : "Select compartment first"}</em></MenuItem>
                                        {moleculeOptions.map(molName => <MenuItem key={molName} value={molName}>{molName}</MenuItem>)}
                                    </HelpField>
                                    {!activeTabData.childPath && <FormHelperText error>Required</FormHelperText>}
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
                                        value={activeTabData.childPath} 
                                        onChange={(id, v) => handleChildPathChange({ target: { value: v } })} 
                                        helptext={helpText.dataSources.childPath}
                                    >
                                        <MenuItem value=""><em>None</em></MenuItem>
                                        {channelPrototypes.map(chan => <MenuItem key={chan} value={chan}>{chan}</MenuItem>)}
                                        <Divider />
                                        <MenuItem value={OPTION_USER_SPECIFIED}>{OPTION_USER_SPECIFIED}</MenuItem>
                                    </HelpField>
                                </Grid>
                             </>
                         )}
                        <Grid item xs={12} sm={6}><HelpField id="title" label="Title (Optional)" value={activeTabData.title} onChange={(id, v) => updateTab(activeTab, id, v)} helptext={helpText.dataSources.title} /></Grid>
                        <Grid item xs={12} sm={6}><HelpField id="diameterScale" label="Diameter Scale" type="number" value={activeTabData.diameterScale} onChange={(id, v) => updateTab(activeTab, id, v)} helptext={helpText.dataSources.diameterScale} /></Grid>
                        <Grid item xs={12} sm={6}><HelpField id="min" label="Min (ymin)" type="number" value={activeTabData.min} onChange={(id, v) => updateTab(activeTab, id, v)} helptext={helpText.dataSources.min} /></Grid>
                        <Grid item xs={12} sm={6}><HelpField id="max" label="Max (ymax)" type="number" value={activeTabData.max} onChange={(id, v) => updateTab(activeTab, id, v)} helptext={helpText.dataSources.max} /></Grid>
                        <Grid item xs={12} sm={6}><HelpField id="dt" label="Frame dt (s)" type="number" value={activeTabData.dt} onChange={(id, v) => updateTab(activeTab, id, v)} helptext={helpText.dataSources.dt} /></Grid>
                    </Grid>
                    <Button variant="outlined" color="secondary" startIcon={<DeleteIcon />} onClick={() => removeTab(activeTab)} sx={{ mt: 2 }}>Remove Data Source</Button>
                </Box>
            )}

            <Divider sx={{ my: 3 }} />
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mb: 0 }}>Global Display Settings</Typography>
                <Tooltip title={helpText.headings.globalSettings} placement="right"><IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton></Tooltip>
            </Box>
            <Box sx={{ mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: '4px' }}>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}><HelpField id="rotation" label="Rotation (rad/step)" type="number" value={globalSettings.rotation} onChange={(id, v) => updateGlobalSetting(id, v)} helptext={helpText.globalSettings.rotation} /></Grid>
                    <Grid item xs={12} sm={6}><HelpField id="azimuth" label="Azimuth (azim)" type="number" value={globalSettings.azimuth} onChange={(id, v) => updateGlobalSetting(id, v)} helptext={helpText.globalSettings.azimuth} /></Grid>
                    <Grid item xs={12} sm={6}><HelpField id="elevation" label="Elevation (elev)" type="number" value={globalSettings.elevation} onChange={(id, v) => updateGlobalSetting(id, v)} helptext={helpText.globalSettings.elevation} /></Grid>
                    <Grid item xs={12} sm={6}><HelpField id="colormap" label="Colormap" select value={globalSettings.colormap} onChange={(id, v) => updateGlobalSetting(id, v)} helptext={helpText.globalSettings.colormap}>{colormapOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}</HelpField></Grid>
                    <Grid item xs={12} sm={6}><HelpField id="background" label="Background (bg)" select value={globalSettings.background} onChange={(id, v) => updateGlobalSetting(id, v)} helptext={helpText.globalSettings.background}>{backgroundOptions.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}</HelpField></Grid>
                    <Grid item xs={12} sm={6}><HelpField id="center" label="Center [x,y,z]" value={globalSettings.center} onChange={(id, v) => updateGlobalSetting(id, v)} helptext={helpText.globalSettings.center} /></Grid>
                    <Grid item xs={12} container spacing={1} sx={{ mt: 1 }}>
                        <Grid item xs="auto"><Tooltip title={helpText.globalSettings.mergeDisplays}><FormControlLabel control={<Checkbox checked={Boolean(globalSettings.mergeDisplays)} onChange={(e) => updateGlobalSetting('mergeDisplays', e.target.checked)} />} label="Merge Displays" /></Tooltip></Grid>
                        <Grid item xs="auto"><Tooltip title={helpText.globalSettings.fullScreen}><FormControlLabel control={<Checkbox checked={Boolean(globalSettings.fullScreen)} onChange={(e) => updateGlobalSetting('fullScreen', e.target.checked)} />} label="Fullscreen" /></Tooltip></Grid>
                        <Grid item xs="auto"><Tooltip title={helpText.globalSettings.block}><FormControlLabel control={<Checkbox checked={Boolean(globalSettings.block)} onChange={(e) => updateGlobalSetting('block', e.target.checked)} />} label="Block Thread" /></Tooltip></Grid>
                    </Grid>
                </Grid>
            </Box>

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

export default ThreeDMenuBox;
