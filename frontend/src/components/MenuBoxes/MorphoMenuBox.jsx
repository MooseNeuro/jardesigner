import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Tabs, Tab, Typography, TextField, Grid, Tooltip, IconButton, Button } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import helpText from './MorphoMenuBox.Help.json';
import fileIcon from '../../assets/file.png';
import somaIcon from '../../assets/soma.png';
import ballAndStickIcon from '../../assets/ballAndStick.png';
import yBranchIcon from '../../assets/ybranch.png';
import { formatFloat } from '../../utils/formatters.js';
import { NeuromorphoDialog } from '../neuromorpho/index.js';
import { AllenBrainDialog } from '../allenbrain/index.js';
import NMOLOGO from '../../assets/DataRepository/NMOLOGO.png';
import ABCLOGO from '../../assets/DataRepository/abc_logo.png';

// --- Unit Conversion Helpers ---
const toMeters = (microns) => {
    const meterValue = (parseFloat(microns) * 1e-6 || 0);
    return Number(formatFloat(meterValue));
};
const toMicrons = (meters) => {
    const micronValue = (parseFloat(meters) || 0) * 1e6;
    return formatFloat(micronValue);
};
const safeToString = (value, defaultValue = '') => (value != null ? String(value) : defaultValue);

// --- Default state values (in MICRONS) ---
const initialSomaState = { somaDia: '10', somaLen: '10' };
const initialBallAndStickState = {
    somaDia: '10', somaLen: '10',
    dendDia: '2', dendLen: '200', dendNumSeg: '1'
};
const initialYBranchState = {
    somaDia: '10', somaLen: '10',
    dendDia: '5', dendLen: '100', dendNumSeg: '1',
    branchDia: '2.5', branchLen: '150', branchNumSeg: '1'
};

// --- Mappings for tabs ---
const typeToIndexMap = { "file": 0, "soma": 1, "ballAndStick": 2, "branchedCell": 3 };
const indexToTypeMap = ["file", "soma", "ballAndStick", "branchedCell"];

// --- Reusable Field Component ---
const HelpField = React.memo(({ id, label, value, onChange, type = "text", fullWidth = true, ...props }) => {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField {...props} fullWidth={fullWidth} size="small" label={label} variant="outlined" type={type}
                value={value} onChange={(e) => onChange(id, e.target.value)} />
            <Tooltip title={props.helptext} placement="right">
                <IconButton size="small"><InfoOutlinedIcon /></IconButton>
            </Tooltip>
        </Box>
    );
});

// --- The Main Component ---
const MorphoMenuBox = ({ onConfigurationChange, currentConfig, onFileChange, clientId }) => {
    const [tabIndex, setTabIndex] = useState(() => typeToIndexMap[currentConfig?.type] ?? 0);

    const [somaValues, setSomaValues] = useState(() =>
        currentConfig?.type === 'soma' ? {
            somaDia: safeToString(toMicrons(currentConfig.somaDia), initialSomaState.somaDia),
            somaLen: safeToString(toMicrons(currentConfig.somaLen), initialSomaState.somaLen),
        } : initialSomaState
    );
    const [ballAndStickValues, setBallAndStickValues] = useState(() =>
        currentConfig?.type === 'ballAndStick' ? {
            somaDia: safeToString(toMicrons(currentConfig.somaDia), initialBallAndStickState.somaDia),
            somaLen: safeToString(toMicrons(currentConfig.somaLen), initialBallAndStickState.somaLen),
            dendDia: safeToString(toMicrons(currentConfig.dendDia), initialBallAndStickState.dendDia),
            dendLen: safeToString(toMicrons(currentConfig.dendLen), initialBallAndStickState.dendLen),
            dendNumSeg: safeToString(currentConfig.dendNumSeg, initialBallAndStickState.dendNumSeg),
        } : initialBallAndStickState
    );
    const [yBranchValues, setYBranchValues] = useState(() =>
        currentConfig?.type === 'branchedCell' ? {
            somaDia: safeToString(toMicrons(currentConfig.somaDia), initialYBranchState.somaDia),
            somaLen: safeToString(toMicrons(currentConfig.somaLen), initialYBranchState.somaLen),
            dendDia: safeToString(toMicrons(currentConfig.dendDia), initialYBranchState.dendDia),
            dendLen: safeToString(toMicrons(currentConfig.dendLen), initialYBranchState.dendLen),
            dendNumSeg: safeToString(currentConfig.dendNumSeg, initialYBranchState.dendNumSeg),
            branchDia: safeToString(toMicrons(currentConfig.branchDia), initialYBranchState.branchDia),
            branchLen: safeToString(toMicrons(currentConfig.branchLen), initialYBranchState.branchLen),
            branchNumSeg: safeToString(currentConfig.branchNumSeg, initialYBranchState.branchNumSeg),
        } : initialYBranchState
    );

    const onConfigurationChangeRef = useRef(onConfigurationChange);
    useEffect(() => { onConfigurationChangeRef.current = onConfigurationChange; }, [onConfigurationChange]);
    const stateRefs = useRef({});
    useEffect(() => {
        stateRefs.current = { tabIndex, somaValues, ballAndStickValues, yBranchValues };
    }, [tabIndex, somaValues, ballAndStickValues, yBranchValues]);
    const fileInputRef = useRef(null);

    const handleSomaChange = useCallback((field, value) => setSomaValues(prev => ({ ...prev, [field]: value })), []);
    const handleBallAndStickChange = useCallback((field, value) => setBallAndStickValues(prev => ({ ...prev, [field]: value })), []);
    const handleYBranchChange = useCallback((field, value) => setYBranchValues(prev => ({ ...prev, [field]: value })), []);
    const handleTabChange = (event, newIndex) => setTabIndex(newIndex);
    const handleFileSelect = () => fileInputRef.current.click();

    // This function now handles the file upload to the server.
    const handleFileChange = async (event) => {
        console.log("File selected. Checking required props:", { onFileChange, clientId });

        const file = event.target.files[0];
        if (!file || !onFileChange || !clientId) return;

        // 1. Create FormData to send the file and session ID.
        const formData = new FormData();
        formData.append('file', file);
        formData.append('clientId', clientId);

        try {
            // 2. POST the file to the server's upload endpoint.
            const uploadUrl = `http://${window.location.hostname}:5000/upload_file`;

            const response = await fetch(uploadUrl, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'File upload failed');
            }

            // 3. On success, update the main app state with the original filename for portability.
            onFileChange({ filename: file.name });

        } catch (error) {
            console.error("Error uploading file:", error);
            alert(`Failed to upload the selected file: ${error.message}`);
        }
    };

    useEffect(() => {
        const getMorphologyDataForUnmount = () => {
            const { tabIndex, somaValues, ballAndStickValues, yBranchValues } = stateRefs.current;
            // Only process if a procedural morphology tab is active. File-based is handled separately.
            if (tabIndex === 0) return null;

            const type = indexToTypeMap[tabIndex];
            if (!type) return null;

            let cellProtoData = { type };
            try {
                switch (tabIndex) {
                    case 1:
                        cellProtoData.somaDia = toMeters(somaValues.somaDia);
                        cellProtoData.somaLen = toMeters(somaValues.somaLen);
                        break;
                    case 2:
                        cellProtoData.somaDia = toMeters(ballAndStickValues.somaDia);
                        cellProtoData.somaLen = toMeters(ballAndStickValues.somaLen);
                        cellProtoData.dendDia = toMeters(ballAndStickValues.dendDia);
                        cellProtoData.dendLen = toMeters(ballAndStickValues.dendLen);
                        cellProtoData.dendNumSeg = parseInt(ballAndStickValues.dendNumSeg, 10) || 1;
                        break;
                    case 3:
                        cellProtoData.somaDia = toMeters(yBranchValues.somaDia);
                        cellProtoData.somaLen = toMeters(yBranchValues.somaLen);
                        cellProtoData.dendDia = toMeters(yBranchValues.dendDia);
                        cellProtoData.dendLen = toMeters(yBranchValues.dendLen);
                        cellProtoData.dendNumSeg = parseInt(yBranchValues.dendNumSeg, 10) || 1;
                        cellProtoData.branchDia = toMeters(yBranchValues.branchDia);
                        cellProtoData.branchLen = toMeters(yBranchValues.branchLen);
                        cellProtoData.branchNumSeg = parseInt(yBranchValues.branchNumSeg, 10) || 1;
                        break;
                    default: break;
                }
            } catch (error) {
                console.error("Error formatting morphology data on unmount:", error);
                return { cellProto: { type: "error" } };
            }
            return { cellProto: cellProtoData };
        };

        return () => {
            if (onConfigurationChangeRef.current) {
                const configData = getMorphologyDataForUnmount();
                if (configData && configData.cellProto?.type !== "error") {
                    onConfigurationChangeRef.current(configData);
                }
            }
        };
    }, []);
    const [open, setOpen] = React.useState(false);
    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);

    const [allenOpen, setAllenOpen] = React.useState(false);
    const handleAllenOpen = () => setAllenOpen(true);
    const handleAllenClose = () => setAllenOpen(false);

    return (
        <Box sx={{ p: 2, background: '#f5f5f5', borderRadius: 2 }}>
            <Tabs value={tabIndex} onChange={handleTabChange} variant="fullWidth">
                <Tooltip title={helpText.tabs.file} placement="top"><Tab icon={<img src={fileIcon} alt="File" style={{ height: 24 }} />} label="File" /></Tooltip>
                <Tooltip title={helpText.tabs.soma} placement="top"><Tab icon={<img src={somaIcon} alt="Soma" style={{ height: 24 }} />} label="Soma" /></Tooltip>
                <Tooltip title={helpText.tabs.ballAndStick} placement="top"><Tab icon={<img src={ballAndStickIcon} alt="Ball and Stick" style={{ height: 24 }} />} label="Ball & Stick" /></Tooltip>
                <Tooltip title={helpText.tabs.yBranch} placement="top"><Tab icon={<img src={yBranchIcon} alt="Y Branch" style={{ height: 24 }} />} label="Y Branch" /></Tooltip>
            </Tabs>
            <Box sx={{ mt: 2, p: 1 }}>
                {tabIndex === 0 && (
                    <Box>
                        <Typography variant="h6" gutterBottom>File-based Morphology</Typography>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept=".swc,.xml" />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={handleFileSelect}>Select Morphology File...</Button>
                            <Tooltip title={helpText.fields.file.source} placement="right"><IconButton size="small"><InfoOutlinedIcon /></IconButton></Tooltip>
                        </Box>
                        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                            <Button
                                component='label'
                                variant="outlined"
                                size="small"
                                tabIndex={-1}
                                startIcon={
                                    <span style={{ display: 'flex', alignItems: 'center', margin: 2 }}>
                                        <img src={NMOLOGO} alt="Neuromorpho.org-Logo"
                                            style={{ width: '30px', height: '25px', marginRight: 8 }}
                                        />
                                    </span>
                                }
                                onClick={handleOpen}
                            >
                                Neuromorpho.org
                            </Button>

                            <NeuromorphoDialog
                                open={open}
                                onClose={handleClose}
                                clientId={clientId}
                                onFileChange={onFileChange}
                            />

                            <Button
                                variant="outlined"
                                size="small"
                                onClick={handleAllenOpen}
                                startIcon={
                                    <img
                                        src={ABCLOGO}
                                        alt="Allen Brain Cell Types"
                                        style={{ width: 30, height: 25, objectFit: 'contain' }}
                                    />
                                }
                            >
                                Allen Brain Cell Type
                            </Button>

                            <AllenBrainDialog
                                open={allenOpen}
                                onClose={handleAllenClose}
                                clientId={clientId}
                                onFileChange={onFileChange}
                            />
                        </Box>

                        {currentConfig.source && (
                            <Typography sx={{ mt: 1, fontStyle: 'italic' }}>
                                Active File: {currentConfig.source}
                            </Typography>
                        )}
                    </Box>
                )}
                {tabIndex === 1 && (
                    <Box>
                        <Typography variant="h6" gutterBottom>Soma</Typography>
                        <Grid container spacing={2}>
                            <Grid item xs={6}><HelpField id="somaDia" label="Diameter (μm)" value={somaValues.somaDia} onChange={handleSomaChange} helptext={helpText.fields.soma.somaDia} /></Grid>
                            <Grid item xs={6}><HelpField id="somaLen" label="Length (μm)" value={somaValues.somaLen} onChange={handleSomaChange} helptext={helpText.fields.soma.somaLen} /></Grid>
                        </Grid>
                    </Box>
                )}
                {tabIndex === 2 && (
                    <Box>
                        <Typography variant="h6" gutterBottom>Ball and Stick</Typography>
                        <Grid container spacing={2} rowSpacing={1.5}>
                            <Grid item xs={12}><Typography variant="subtitle2" color="text.secondary">Soma</Typography></Grid>
                            <Grid item xs={6}><HelpField id="somaDia" label="Diameter (μm)" value={ballAndStickValues.somaDia} onChange={handleBallAndStickChange} helptext={helpText.fields.ballAndStick.somaDia} /></Grid>
                            <Grid item xs={6}><HelpField id="somaLen" label="Length (μm)" value={ballAndStickValues.somaLen} onChange={handleBallAndStickChange} helptext={helpText.fields.ballAndStick.somaLen} /></Grid>
                            <Grid item xs={12} sx={{ mt: 1 }}><Typography variant="subtitle2" color="text.secondary">Dendrite</Typography></Grid>
                            <Grid item xs={6}><HelpField id="dendDia" label="Diameter (μm)" value={ballAndStickValues.dendDia} onChange={handleBallAndStickChange} helptext={helpText.fields.ballAndStick.dendDia} /></Grid>
                            <Grid item xs={6}><HelpField id="dendLen" label="Length (μm)" value={ballAndStickValues.dendLen} onChange={handleBallAndStickChange} helptext={helpText.fields.ballAndStick.dendLen} /></Grid>
                            <Grid item xs={12}><HelpField id="dendNumSeg" label="Segments (#)" value={ballAndStickValues.dendNumSeg} onChange={handleBallAndStickChange} type="number" helptext={helpText.fields.ballAndStick.dendNumSeg} InputProps={{ inputProps: { min: 1, step: 2 } }} /></Grid>
                        </Grid>
                    </Box>
                )}
                {tabIndex === 3 && (
                    <Box>
                        <Typography variant="h6" gutterBottom>Y Branch</Typography>
                        <Grid container spacing={2} rowSpacing={1.5}>
                            <Grid item xs={12}><Typography variant="subtitle2" color="text.secondary">Soma</Typography></Grid>
                            <Grid item xs={6}><HelpField id="somaDia" label="Diameter (μm)" value={yBranchValues.somaDia} onChange={handleYBranchChange} helptext={helpText.fields.yBranch.somaDia} /></Grid>
                            <Grid item xs={6}><HelpField id="somaLen" label="Length (μm)" value={yBranchValues.somaLen} onChange={handleYBranchChange} helptext={helpText.fields.yBranch.somaLen} /></Grid>
                            <Grid item xs={12} sx={{ mt: 1 }}><Typography variant="subtitle2" color="text.secondary">Dendrite Trunk</Typography></Grid>
                            <Grid item xs={6}><HelpField id="dendDia" label="Diameter (μm)" value={yBranchValues.dendDia} onChange={handleYBranchChange} helptext={helpText.fields.yBranch.dendDia} /></Grid>
                            <Grid item xs={6}><HelpField id="dendLen" label="Length (μm)" value={yBranchValues.dendLen} onChange={handleYBranchChange} helptext={helpText.fields.yBranch.dendLen} /></Grid>
                            <Grid item xs={12}><HelpField id="dendNumSeg" label="Segments (#)" value={yBranchValues.dendNumSeg} onChange={handleYBranchChange} type="number" helptext={helpText.fields.yBranch.dendNumSeg} InputProps={{ inputProps: { min: 1, step: 1 } }} /></Grid>
                            <Grid item xs={12} sx={{ mt: 1 }}><Typography variant="subtitle2" color="text.secondary">Daughter Branches</Typography></Grid>
                            <Grid item xs={6}><HelpField id="branchDia" label="Diameter (μm)" value={yBranchValues.branchDia} onChange={handleYBranchChange} helptext={helpText.fields.yBranch.branchDia} /></Grid>
                            <Grid item xs={6}><HelpField id="branchLen" label="Length (μm)" value={yBranchValues.branchLen} onChange={handleYBranchChange} helptext={helpText.fields.yBranch.branchLen} /></Grid>
                            <Grid item xs={12}><HelpField id="branchNumSeg" label="Segments (#)" value={yBranchValues.branchNumSeg} onChange={handleYBranchChange} type="number" helptext={helpText.fields.yBranch.branchNumSeg} InputProps={{ inputProps: { min: 1, step: 1 } }} /></Grid>
                        </Grid>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default MorphoMenuBox;
