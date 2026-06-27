import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Typography, TextField, Grid, Button, CircularProgress, Alert, Divider, Checkbox, FormControlLabel, Tooltip } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

const helpText = {
    runControls: { totalRuntime: "The total duration for the simulation run in seconds.", currentTime: "The current time of the active simulation." },
    clocks: { main: "Time step settings for different simulation components.", elecDt: "Electrical time step.", chemDt: "Chemical/signaling time step.", diffusionDt: "Diffusion time step.", elecPlotDt: "Time step for plotting electrical data.", chemPlotDt: "Time step for plotting chemical data.", functionDt: "Time step for functional evaluation.", statusDt: "Time step for status updates." },
    configuration: { main: "Global settings for the simulation model." },
    flags: { turnOffElec: "Disable all electrical calculations.", combineSegments: "Combine adjacent segments with identical properties.", useGssa: "Use Gillespie's Stochastic Simulation Algorithm.", reuseLibraryCell: "Reuse cell from library if available." },
    otherSettings: { modelPath: "Path to the model on the server.", odeMethod: "Method for solving ordinary differential equations.", randSeed: "Seed for random number generation.", temperature: "Simulation temperature in Celsius." }
};


const safeToString = (value, defaultValue = '') => {
    if (value === null || value === undefined) {
        return defaultValue;
    }
    return String(value);
};

const defaultRunConfig = {
    runtime: '0.3',
    elecDt: '50e-6',
    elecPlotDt: '100e-6',
    chemDt: '0.1',
    chemPlotDt: '1.0',
    diffDt: '10e-3',
    funcDt: '100e-6',
    statusDt: '0.0',
    randseed: '1234',
    temperature: '32',
    turnOffElec: false,
    useGssa: false,
    combineSegments: true,
    stealCellFromLibrary: false,
    modelPath: '/model',
    odeMethod: 'lsoda',
};

const InfoTooltip = ({ title }) => (
    <Tooltip title={title}>
        <InfoOutlinedIcon sx={{ fontSize: '1.1rem', color: 'action.active', cursor: 'pointer' }} />
    </Tooltip>
);

const RunMenuBox = ({
    onConfigurationChange,
    setRunParameters,
    currentConfig,
    onStartRun,
    onResetRun,
    onBuildAndStartRun,
    onStopRun,
    isSimulating,
    activeSimPid,
    liveFrameData,
    isReplaying,
}) => {

    const [runtime, setRuntime] = useState(() => safeToString(currentConfig?.runtime, defaultRunConfig.runtime));
    const [clocks, setClocks] = useState(() => ({
        elec: safeToString(currentConfig?.elecDt, defaultRunConfig.elecDt),
        elecPlot: safeToString(currentConfig?.elecPlotDt, defaultRunConfig.elecPlotDt),
        chem: safeToString(currentConfig?.chemDt, defaultRunConfig.chemDt),
        chemPlotDt: safeToString(currentConfig?.chemPlotDt, defaultRunConfig.chemPlotDt),
        diffusion: safeToString(currentConfig?.diffDt, defaultRunConfig.diffDt),
        function: safeToString(currentConfig?.funcDt, defaultRunConfig.funcDt),
        status: safeToString(currentConfig?.statusDt, defaultRunConfig.statusDt),
    }));
    const [configSettings, setConfigSettings] = useState(() => {
        return {
            randSeed: safeToString(currentConfig?.randseed, defaultRunConfig.randseed),
            temperature: safeToString(currentConfig?.temperature, defaultRunConfig.temperature),
            modelPath: safeToString(currentConfig?.modelPath, defaultRunConfig.modelPath),
            odeMethod: safeToString(currentConfig?.odeMethod, defaultRunConfig.odeMethod),
            turnOffElec: currentConfig?.turnOffElec ?? defaultRunConfig.turnOffElec,
            useGssa: currentConfig?.useGssa ?? defaultRunConfig.useGssa,
            combineSegments: currentConfig?.combineSegments ?? defaultRunConfig.combineSegments,
            reuseLibraryCell: currentConfig?.stealCellFromLibrary ?? defaultRunConfig.stealCellFromLibrary,
        };
    });

    const [currentTime, setCurrentTime] = useState(0.0);
    const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

    // Compute button text based on state
    const startButtonText = isSimulating 
        ? 'Running...' 
            : currentTime > 0 
                ? 'Continue' 
                : 'Start';

    const onConfigurationChangeRef = useRef(onConfigurationChange);
    useEffect(() => { onConfigurationChangeRef.current = onConfigurationChange; }, [onConfigurationChange]);

    // Saves elecPlotDt, funcDt, and per-drawable moogli dt before turnOffElec overrides them
    const savedDtsRef = useRef(null);
    
    useEffect(() => {
        if (isReplaying) {
            setStatusMessage({ type: 'info', text: 'Replaying simulation in 3D viewer...' });
        } else if (isSimulating) {
            setStatusMessage({ type: 'info', text: `Simulation running (PID: ${activeSimPid})...` });
        } else if (activeSimPid) {
            setStatusMessage({ type: 'success', text: `Model built (PID: ${activeSimPid}). Ready to run or replay.` });
        } else {
            setStatusMessage({ type: 'info', text: 'No active simulation. Change a setting to build the model.' });
        }
    }, [isSimulating, isReplaying, activeSimPid, currentTime]);

	useEffect(() => {
    	const frameForRunView = liveFrameData?.run;
    	if (frameForRunView && typeof frameForRunView.timestamp === 'number') {
        	setCurrentTime(frameForRunView.timestamp);
    	}
	}, [liveFrameData]);

    const handleRuntimeChange = (value) => setRuntime(value);
    const updateClock = (field, value) => setClocks((prev) => ({ ...prev, [field]: value }));
    const updateConfigSetting = (field, value) => setConfigSettings((prev) => ({ ...prev, [field]: value }));

    const handleTurnOffElecChange = () => {
        const isTurningOff = !configSettings.turnOffElec;
        setConfigSettings(prev => ({ ...prev, turnOffElec: isTurningOff }));

        if (isTurningOff) {
            const newRuntime = '100';
            // Save values that will be overridden, including current runtime
            savedDtsRef.current = {
                runtime,
                elecPlot: clocks.elecPlot,
                function: clocks.function,
                moogli: currentConfig.moogli?.map(m => m.dt) ?? [],
            };
            setRuntime(newRuntime);
            const runtimeNum = parseFloat(newRuntime);
            const newFuncDt = parseFloat(clocks.chem) || parseFloat(defaultRunConfig.chemDt);
            setClocks(prev => ({ ...prev, elecPlot: newRuntime, function: String(newFuncDt) }));
            const chemFields = ['conc', 'n', 'concInit', 'nInit', 'volume'];
            const newMoogli = currentConfig.moogli?.length > 0
                ? currentConfig.moogli.map(m => chemFields.includes(m.field) ? m : { ...m, dt: runtimeNum })
                : undefined;
            onConfigurationChange({
                turnOffElec: true,
                runtime: runtimeNum,
                elecPlotDt: runtimeNum,
                funcDt: newFuncDt,
                ...(newMoogli ? { moogli: newMoogli } : {}),
            });
        } else {
            const saved = savedDtsRef.current;
            const restoredRuntime = saved?.runtime ?? '0.3';
            setRuntime(restoredRuntime);
            if (saved) {
                setClocks(prev => ({
                    ...prev,
                    elecPlot: saved.elecPlot,
                    function: saved.function,
                }));
                const restoredMoogli = (currentConfig.moogli?.length > 0 && saved.moogli.length > 0)
                    ? currentConfig.moogli.map((m, i) => ({
                        ...m,
                        dt: saved.moogli[i] !== undefined ? saved.moogli[i] : m.dt,
                      }))
                    : undefined;
                onConfigurationChange({
                    turnOffElec: false,
                    runtime: parseFloat(restoredRuntime),
                    elecPlotDt: parseFloat(saved.elecPlot) || parseFloat(defaultRunConfig.elecPlotDt),
                    funcDt: parseFloat(saved.function) || parseFloat(defaultRunConfig.funcDt),
                    ...(restoredMoogli ? { moogli: restoredMoogli } : {}),
                });
                savedDtsRef.current = null;
            } else {
                onConfigurationChange({ turnOffElec: false });
            }
        }
    };

    const buildConfigPayload = useCallback(() => {
        const getOrDefaultNumeric = (valStr, defaultValStr) => parseFloat(valStr) || parseFloat(defaultValStr);
        const getOrDefaultInt = (valStr, defaultValStr) => parseInt(valStr, 10) || parseInt(defaultValStr, 10);

        return {
            runtime: getOrDefaultNumeric(runtime, defaultRunConfig.runtime),
            elecDt: getOrDefaultNumeric(clocks.elec, defaultRunConfig.elecDt),
            elecPlotDt: getOrDefaultNumeric(clocks.elecPlot, defaultRunConfig.elecPlotDt),
            chemDt: getOrDefaultNumeric(clocks.chem, defaultRunConfig.chemDt),
            chemPlotDt: getOrDefaultNumeric(clocks.chemPlotDt, defaultRunConfig.chemPlotDt),
            diffDt: getOrDefaultNumeric(clocks.diffusion, defaultRunConfig.diffDt),
            funcDt: getOrDefaultNumeric(clocks.function, defaultRunConfig.funcDt),
            statusDt: getOrDefaultNumeric(clocks.status, defaultRunConfig.statusDt),
            randseed: getOrDefaultInt(configSettings.randSeed, defaultRunConfig.randseed),
            temperature: getOrDefaultNumeric(configSettings.temperature, defaultRunConfig.temperature),
            turnOffElec: configSettings.turnOffElec,
            useGssa: configSettings.useGssa,
            combineSegments: configSettings.combineSegments,
            stealCellFromLibrary: configSettings.reuseLibraryCell,
            modelPath: configSettings.modelPath,
            odeMethod: configSettings.odeMethod,
        };
    }, [runtime, clocks, configSettings]);

    // Ref updated every render so the unmount cleanup always calls the latest version.
    const buildConfigPayloadRef = useRef(buildConfigPayload);
    buildConfigPayloadRef.current = buildConfigPayload;

    // Save config to parent only when this menu box is closed (unmounted).
    // Empty dep array: the cleanup only runs on unmount, not on every local state change.
    // buildConfigPayloadRef ensures we always call the latest version on unmount.
    useEffect(() => {
        return () => {
            if (onConfigurationChangeRef.current) {
                onConfigurationChangeRef.current(buildConfigPayloadRef.current());
            }
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleStart = () => {
        const latestConfig = buildConfigPayload();
        if (currentTime === 0) {
            // New start: delegate to parent which decides if rebuild is needed.
            if (onBuildAndStartRun) {
                onBuildAndStartRun(latestConfig);
            }
        } else {
            // Continue: update params without rebuild, then start with explicit runtime.
            if (setRunParameters) {
                setRunParameters(latestConfig);
            }
            if (onStartRun) {
                onStartRun(latestConfig.runtime);
            }
        }
    };

    const handleStop = () => {
        if (onStopRun) {
            onStopRun();
        }
    };

    const handleReset = () => {
        setCurrentTime(0.0);
        if (onResetRun) {
            onResetRun();
        }
    };

    return (
        <Box sx={{ p: 2, background: '#f5f5f5', borderRadius: 2 }}>
            <Grid container spacing={1} sx={{ mb: 2 }}>
                <Grid item xs={4}><Button variant="contained" fullWidth startIcon={isSimulating ? <CircularProgress size={20} color="inherit" /> : <PlayArrowIcon />} sx={{ bgcolor: 'success.main', '&:hover': { bgcolor: 'success.dark' } }} onClick={handleStart} disabled={isSimulating || !activeSimPid}>{startButtonText}</Button></Grid>
                <Grid item xs={4}><Button variant="contained" fullWidth startIcon={<StopIcon />} sx={{ bgcolor: 'error.main', '&:hover': { bgcolor: 'error.dark' } }} onClick={handleStop} disabled={!isSimulating}>Stop</Button></Grid>
                <Grid item xs={4}><Button variant="contained" fullWidth startIcon={<RestartAltIcon />} sx={{ bgcolor: '#ffeb3b', color: 'rgba(0, 0, 0, 0.87)', '&:hover': { bgcolor: '#fdd835' } }} onClick={handleReset} disabled={!activeSimPid}>Reset</Button></Grid>
            </Grid>

            {statusMessage.text && <Alert severity={statusMessage.type || 'info'} sx={{ mb: 2, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{statusMessage.text}</Alert>}

            <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Grid item xs={6}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TextField fullWidth size="small" label="Total Runtime (s)" type="text" value={runtime} onChange={(e) => handleRuntimeChange(e.target.value)} />
                        <InfoTooltip title={helpText.runControls.totalRuntime} />
                    </Box>
                </Grid>
                <Grid item xs={6}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TextField fullWidth size="small" label="Current Time (s)" type="number" value={currentTime.toFixed(4)} InputProps={{ readOnly: true }} variant="filled" />
                        <InfoTooltip title={helpText.runControls.currentTime} />
                    </Box>
                </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Simulation Time Steps (Clocks)</Typography>
                <InfoTooltip title={helpText.clocks.main} />
            </Box>

            <Grid container spacing={1.5} sx={{mb: 2}}>
                <Grid item xs={12} sm={6} container spacing={1.5}>
                    <Grid item xs={12}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><TextField fullWidth size="small" label="Elec Dt (s)" value={clocks.elec} onChange={(e) => updateClock('elec', e.target.value)} disabled={configSettings.turnOffElec} /><InfoTooltip title={helpText.clocks.elecDt} /></Box></Grid>
                    <Grid item xs={12}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><TextField fullWidth size="small" label="Chem Dt (s)" value={clocks.chem} onChange={(e) => updateClock('chem', e.target.value)} /><InfoTooltip title={helpText.clocks.chemDt} /></Box></Grid>
                    <Grid item xs={12}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><TextField fullWidth size="small" label="Diffusion Dt (s)" value={clocks.diffusion} onChange={(e) => updateClock('diffusion', e.target.value)} /><InfoTooltip title={helpText.clocks.diffusionDt} /></Box></Grid>
                </Grid>
                <Grid item xs={12} sm={6} container spacing={1.5}>
                    <Grid item xs={12}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><TextField fullWidth size="small" label="Elec Plot Dt (s)" value={clocks.elecPlot} onChange={(e) => updateClock('elecPlot', e.target.value)} disabled={configSettings.turnOffElec} /><InfoTooltip title={helpText.clocks.elecPlotDt} /></Box></Grid>
                    <Grid item xs={12}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><TextField fullWidth size="small" label="Chem Plot Dt (s)" value={clocks.chemPlotDt} onChange={(e) => updateClock('chemPlotDt', e.target.value)} /><InfoTooltip title={helpText.clocks.chemPlotDt} /></Box></Grid>
                    <Grid item xs={12}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><TextField fullWidth size="small" label="Function Dt (s)" value={clocks.function} onChange={(e) => updateClock('function', e.target.value)} /><InfoTooltip title={helpText.clocks.functionDt} /></Box></Grid>
                    <Grid item xs={12}><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><TextField fullWidth size="small" label="Status Dt (s)" value={clocks.status} onChange={(e) => updateClock('status', e.target.value)} /><InfoTooltip title={helpText.clocks.statusDt} /></Box></Grid>
                </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Configuration Settings</Typography>
            </Box>

            <Typography variant="body2" gutterBottom sx={{ mt: 1, fontWeight: 'medium' }}>Flags</Typography>
            <Grid container spacing={1} rowSpacing={0}>
                <Grid item xs={6}><Tooltip title={helpText.flags.turnOffElec}><FormControlLabel control={ <Checkbox size="small" checked={configSettings.turnOffElec} onChange={handleTurnOffElecChange} /> } label="Turn Off Elec" /></Tooltip></Grid>
                <Grid item xs={6}><Tooltip title={helpText.flags.combineSegments}><FormControlLabel control={ <Checkbox size="small" checked={configSettings.combineSegments} onChange={() => { const v = !configSettings.combineSegments; updateConfigSetting('combineSegments', v); onConfigurationChange({ combineSegments: v }); }} /> } label="Combine Segments" /></Tooltip></Grid>
                <Grid item xs={6}><Tooltip title={helpText.flags.useGssa}><FormControlLabel control={ <Checkbox size="small" checked={configSettings.useGssa} onChange={() => { const v = !configSettings.useGssa; updateConfigSetting('useGssa', v); onConfigurationChange({ useGssa: v }); }} /> } label="Use GSSA" /></Tooltip></Grid>
                <Grid item xs={6}><Tooltip title={helpText.flags.reuseLibraryCell}><FormControlLabel control={ <Checkbox size="small" checked={configSettings.reuseLibraryCell} onChange={() => { const v = !configSettings.reuseLibraryCell; updateConfigSetting('reuseLibraryCell', v); onConfigurationChange({ stealCellFromLibrary: v }); }} /> } label="Reuse Library Cell" /></Tooltip></Grid>
            </Grid>

            <Typography variant="body2" gutterBottom sx={{ mt: 2, fontWeight: 'medium' }}>Other Settings</Typography>
            <Grid container spacing={1.5}>
                <Grid item xs={12} sm={6}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <TextField fullWidth size="small" label="Model Path" value={configSettings.modelPath} onChange={(e) => updateConfigSetting('modelPath', e.target.value)} />
                        <InfoTooltip title={helpText.otherSettings.modelPath} />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <TextField fullWidth size="small" label="ODE Method" value={configSettings.odeMethod} onChange={(e) => updateConfigSetting('odeMethod', e.target.value)} />
                        <InfoTooltip title={helpText.otherSettings.odeMethod} />
                    </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                     <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <TextField fullWidth size="small" label="Rand Seed" type="number" value={configSettings.randSeed} onChange={(e) => updateConfigSetting('randSeed', e.target.value)} />
                        <InfoTooltip title={helpText.otherSettings.randSeed} />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TextField fullWidth size="small" label="Temperature (°C)" type="text" value={configSettings.temperature} onChange={(e) => updateConfigSetting('temperature', e.target.value)} />
                        <InfoTooltip title={helpText.otherSettings.temperature} />
                    </Box>
                </Grid>
            </Grid>
        </Box>
    );
};

export default RunMenuBox;