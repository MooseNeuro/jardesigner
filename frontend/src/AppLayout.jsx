import React, { useMemo } from 'react';
import { AppBar, Toolbar, Button, Grid, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Typography, Box } from '@mui/material';
import runIcon from './assets/run.png';
import morphoIcon from './assets/morpho.png';
import spinesIcon from './assets/spines.png';
import elecIcon from './assets/chan.png';
import passiveIcon from './assets/passive.png';
import chemIcon from './assets/chem.png';
import adaptorsIcon from './assets/adaptors.png';
import plotsIcon from './assets/plots.png';
import stimIcon from './assets/stim.png';
import d3Icon from './assets/3D.png';
import fileIcon from './assets/file.png';
import simOutputIcon from './assets/simOutput.png';
import FileMenuBox from './components/MenuBoxes/FileMenuBox';
import SimOutputMenuBox from './components/MenuBoxes/SimOutputMenuBox';
import RunMenuBox from './components/MenuBoxes/RunMenuBox';
import MorphoMenuBox from './components/MenuBoxes/MorphoMenuBox';
import SpineMenuBox from './components/MenuBoxes/SpineMenuBox';
import ElecMenuBox from './components/MenuBoxes/ElecMenuBox';
import PassiveMenuBox from './components/MenuBoxes/PassiveMenuBox';
import ChemMenuBox from './components/MenuBoxes/ChemMenuBox';
import AdaptorsMenuBox from './components/MenuBoxes/AdaptorsMenuBox';
import PlotMenuBox from './components/MenuBoxes/PlotMenuBox';
import ThreeDMenuBox from './components/MenuBoxes/ThreeDMenuBox';
import StimMenuBox from './components/MenuBoxes/StimMenuBox';
import DisplayWindow from './components/DisplayWindow';
import { ReplayContext } from './components/ReplayContext';

// --- Helper: Analyze Error Message ---
const analyzeError = (error) => {
  if (!error) return { mean: null, do: null };
  
  const msg = error.message || "";
  const details = error.details || "";
  const fullText = (msg + " " + details);
  const lowerText = fullText.toLowerCase();

  // Define fallback response for "Any other error"
  const fallback = {
      mean: "We haven't noticed this one yet",
      do: "File a bug report. We'll fix it or put in a better explanation"
  };

  // 1. Check for C++ allocation failure (std:bad_alloc)
  if (lowerText.includes("std:bad_alloc") || lowerText.includes("std::bad_alloc")) {
    return {
      mean: "Congratulations! You have crashed the C++ code. Quite possibly you have removed a prototype channel after already using it in the channel distribution, or have renamed it",
      do: "Check that your prototype list matches the channels or other objects made from them. If this doesn't help, file bug report."
    };
  }

  // 2. Check for "invalid parser state"
  if (lowerText.includes("invalid parser state")) {
    return {
      mean: "You have made a mistake in a stimulus expression",
      do: "Check your stimulus expressions."
    };
  }

  // 3. Check for "relpath"
  if (lowerText.includes("relpath")) {
    return {
      mean: "You have selected a field which is not present on an electrical compartment. It probably is a field of a channel or Ca_conc object",
      do: "Check your stimuli, plots and so on to see if you have mistakenly selected the wrong field."
    };
  }

  // 4. Check for "list index out of range"
  if (lowerText.includes("list index out of range")) {
    if (fullText.includes("parentDendName")) {
      return {
        mean: "You have entered the wrong string for naming a dendrite or soma compartment",
        do: "Check the allowed paths for compartments by clicking on the desired part of the cell in Setup 3D."
      };
    }
    // Override: If list index is out of range but NOT parentDendName, 
    // we return fallback immediately.
    return fallback;
  }
  
  // 5. Check for "Failed to find field" AND "on dest" (New Case)
  if (lowerText.includes("failed to find field") && lowerText.includes("on dest")) {
    return {
        mean: "Possibly incorrect index for a molecule.",
        do: "Check that the range is OK. Check that you put it in square brackets like [0]"
    };
  }

  // 6. Check for "jardesigner.py" line number (Standard Base Code Error)
  if (fullText.includes("jardesigner.py") && lowerText.includes("line ")) {
    return {
      mean: "Error in jardesigner base code",
      do: "File bug report with jardesigner team"
    };
  }

  // 7. Fallback for any other error
  return fallback;
};

export const AppLayout = (props) => {
  const {
    activeMenu,
    toggleMenu,
    jsonData,
    updateJsonData,
    updateJsonString,
    handleClearModel,
    getCurrentJsonData,
    getChemProtos,
    handleStartRun,
    handlePauseRun,     // Pause handler
    handleResumeRun,    // Resume handler
    handleResetRun,
    isSimulating,
    isPaused,           // Pause state
    activeSim,
    liveFrameData,
    isReplaying,
    handleMorphologyFileChange,
    replayTime,
    clientId,
    clickSelected,
    threeDConfigs,
    meshMolsData,
    simError,     
    setSimError,
    elecPaths,
    spinePaths
  } = props;

  // Extract channel names for use in Plots, Stimuli, and Adaptors.
  // Two sources are merged:
  //   1. jsonData.chanProto — channels the user explicitly defined in the model config.
  //   2. Scene graph drawables with title "chan_*" — includes spine receptor channels
  //      (AMPAR, NMDAR, Ca_conc) registered by the engine with visible=false. These
  //      must be included for relpath selection regardless of their display visibility.
  const channelPrototypes = useMemo(() => {
    const fromConfig = jsonData.chanProto?.map(p => p.name).filter(Boolean) || [];
    const setupDrawables = threeDConfigs?.['setup']?.drawables || [];
    const fromScene = setupDrawables
      .filter(d => d.title?.startsWith('chan_'))
      .map(d => d.title.slice(5))  // strip "chan_" prefix to get the prototype name
      .filter(Boolean);
    return [...new Set([...fromConfig, ...fromScene])];
  }, [jsonData.chanProto, threeDConfigs]);

  const menuComponents = useMemo(() => ({
    File: <FileMenuBox setJsonContent={updateJsonString} onClearModel={handleClearModel} getCurrentJsonData={getCurrentJsonData} currentConfig={jsonData.fileinfo} clientId={clientId} />,
    SimOutput: <SimOutputMenuBox 
        onConfigurationChange={updateJsonData} 
        currentConfig={jsonData.files} 
        getChemProtos={getChemProtos} 
        elecPaths={elecPaths} 
        spinePaths={spinePaths} 
    />,
    Run: <RunMenuBox
      onConfigurationChange={updateJsonData}
      currentConfig={{ ...jsonData }}
      onStartRun={handleStartRun}
      onPauseRun={handlePauseRun}      // Pass pause handler
      onResumeRun={handleResumeRun}    // Pass resume handler
      onResetRun={handleResetRun}
      isSimulating={isSimulating}
      isPaused={isPaused}              // Pass pause state
      activeSimPid={activeSim.pid}
      liveFrameData={liveFrameData}
      isReplaying={isReplaying}
    />,
    Morphology: <MorphoMenuBox 
        onConfigurationChange={updateJsonData} 
        currentConfig={jsonData.cellProto} 
        onFileChange={handleMorphologyFileChange} 
        clientId={clientId} 
    />,
    Spines: <SpineMenuBox 
        onConfigurationChange={updateJsonData} 
        currentConfig={{ spineProto: jsonData.spineProto, spineDistrib: jsonData.spineDistrib }} 
        elecPaths={elecPaths} 
        spinePaths={spinePaths} 
    />,
    Channels: <ElecMenuBox 
        onConfigurationChange={updateJsonData} 
        currentConfig={{ chanProto: jsonData.chanProto, chanDistrib: jsonData.chanDistrib }} 
        clientId={clientId}
        elecPaths={elecPaths} 
        spinePaths={spinePaths} 
    />,
    Passive: <PassiveMenuBox 
        onConfigurationChange={updateJsonData} 
        currentConfig={jsonData.passiveDistrib} 
        elecPaths={elecPaths} 
        spinePaths={spinePaths} 
    />,
    Signaling: <ChemMenuBox 
        onConfigurationChange={updateJsonData} 
        currentConfig={{ chemProto: jsonData.chemProto, chemDistrib: jsonData.chemDistrib }} 
        getChemProtos={getChemProtos} 
        clientId={clientId}
        meshMols={meshMolsData?.setup} 
        elecPaths={elecPaths} 
        spinePaths={spinePaths} 
    />,
    Adaptors: <AdaptorsMenuBox 
        onConfigurationChange={updateJsonData} 
        currentConfig={jsonData.adaptors}
        meshMols={meshMolsData?.setup} 
        // --- Added channelPrototypes ---
        channelPrototypes={channelPrototypes}
    />,
    Stimuli: <StimMenuBox 
        onConfigurationChange={updateJsonData} 
        currentConfig={jsonData.stims} 
        meshMols={meshMolsData?.setup} 
        elecPaths={elecPaths} 
        spinePaths={spinePaths}
        // --- Added channelPrototypes ---
        channelPrototypes={channelPrototypes}
    />,
    Plots: <PlotMenuBox 
        onConfigurationChange={updateJsonData} 
        currentConfig={jsonData.plots} 
        meshMols={meshMolsData?.setup} 
        elecPaths={elecPaths} 
        spinePaths={spinePaths} 
        // --- Added channelPrototypes ---
        channelPrototypes={channelPrototypes}
    />,
    '3D': <ThreeDMenuBox 
        onConfigurationChange={updateJsonData} 
        currentConfig={{ moogli: jsonData.moogli, displayMoogli: jsonData.displayMoogli }} 
        meshMols={meshMolsData?.setup} 
        elecPaths={elecPaths} 
        spinePaths={spinePaths}
        channelPrototypes={channelPrototypes}
    />,
  }), [
    jsonData, updateJsonData, updateJsonString, handleClearModel, getCurrentJsonData, getChemProtos,
    handleStartRun, handlePauseRun, handleResumeRun, handleResetRun,  // Added pause handlers
    isSimulating, isPaused, activeSim.pid, liveFrameData, isReplaying,  // Added isPaused
    handleMorphologyFileChange, 
    clientId,
    threeDConfigs,
    meshMolsData,
    elecPaths, 
    spinePaths,
    channelPrototypes // Added to dependency array
  ]);

  const errorAnalysis = useMemo(() => analyzeError(simError), [simError]);

  return (
    <ReplayContext.Provider value={{ replayTime }}>
      <AppBar position="static">
        <Toolbar style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap' }}>
            <Button color="inherit" onClick={() => toggleMenu('File')} style={{ flexDirection: 'column', color: activeMenu === 'File' ? 'orange' : 'inherit' }} >
                <img src={fileIcon} alt="File Icon" style={{ width: '72px', marginBottom: '4px' }} />
                File
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('Run')} style={{ flexDirection: 'column', color: activeMenu === 'Run' ? 'orange' : 'inherit' }} >
                <img src={runIcon} alt="Run Icon" style={{ width: '72px', marginBottom: '4px' }} />
                Run
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('Morphology')} style={{ flexDirection: 'column', color: activeMenu === 'Morphology' ? 'orange' : 'inherit' }} >
                <img src={morphoIcon} alt="Morphology Icon" style={{ width: '72px', marginBottom: '4px' }} />
                Morphology
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('Spines')} style={{ flexDirection: 'column', color: activeMenu === 'Spines' ? 'orange' : 'inherit' }} >
                <img src={spinesIcon} alt="Spines Icon" style={{ width: '72px', marginBottom: '4px' }} />
                Spines
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('Channels')} style={{ flexDirection: 'column', color: activeMenu === 'Channels' ? 'orange' : 'inherit' }} >
                <img src={elecIcon} alt="Channels Icon" style={{ width: '72px', marginBottom: '4px' }} />
                Channels
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('Passive')} style={{ flexDirection: 'column', color: activeMenu === 'Passive' ? 'orange' : 'inherit' }} >
                <img src={passiveIcon} alt="Passive Icon" style={{ width: '72px', marginBottom: '4px' }} />
                Passive
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('Signaling')} style={{ flexDirection: 'column', color: activeMenu === 'Signaling' ? 'orange' : 'inherit' }} >
                <img src={chemIcon} alt="Signaling Icon" style={{ width: '72px', marginBottom: '4px' }} />
                Signaling
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('Adaptors')} style={{ flexDirection: 'column', color: activeMenu === 'Adaptors' ? 'orange' : 'inherit' }} >
                <img src={adaptorsIcon} alt="Adaptors Icon" style={{ width: '72px', marginBottom: '4px' }} />
                Adaptors
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('Stimuli')} style={{ flexDirection: 'column', color: activeMenu === 'Stimuli' ? 'orange' : 'inherit' }} >
                <img src={stimIcon} alt="Stimuli Icon" style={{ width: '72px', marginBottom: '4px' }} />
                Stimuli
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('Plots')} style={{ flexDirection: 'column', color: activeMenu === 'Plots' ? 'orange' : 'inherit' }} >
                <img src={plotsIcon} alt="Plots Icon" style={{ width: '72px', marginBottom: '4px' }} />
                Plots
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('3D')} style={{ flexDirection: 'column', color: activeMenu === '3D' ? 'orange' : 'inherit' }} >
                <img src={d3Icon} alt="3D Icon" style={{ width: '72px', marginBottom: '4px' }} />
                3D
            </Button>
            <Button color="inherit" onClick={() => toggleMenu('SimOutput')} style={{ flexDirection: 'column', color: activeMenu === 'SimOutput' ? 'orange' : 'inherit' }} >
                <img src={simOutputIcon} alt="Sim Output Icon" style={{ width: '72px', marginBottom: '4px' }} />
                Sim Output
            </Button>
        </Toolbar>
      </AppBar>

      <Grid container spacing={2} style={{ padding: '16px', height: 'calc(100vh - 64px)' }}>
        <Grid item xs={4} style={{ height: '100%' }}>
          {activeMenu && menuComponents[activeMenu]}
        </Grid>
        <Grid item xs={8} style={{ height: '100%' }}>
          <DisplayWindow
            {...props}
          />
        </Grid>
      </Grid>

      {/* Error Dialog */}
      <Dialog
        open={!!simError}
        onClose={() => setSimError(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ color: 'error.main' }}>Simulation Error</DialogTitle>
        <DialogContent>
            <DialogContentText sx={{ mb: 2, fontWeight: 'bold' }}>
                {simError?.message}
            </DialogContentText>
            {simError?.details && (
                <pre style={{ 
                    whiteSpace: 'pre-wrap', 
                    wordBreak: 'break-word', 
                    backgroundColor: '#f5f5f5', 
                    padding: '10px',
                    fontSize: '0.85rem',
                    maxHeight: '300px',
                    overflow: 'auto'
                }}>
                    {simError.details}
                </pre>
            )}

            {/* Analysis Sections */}
            {errorAnalysis.mean && (
                <Box sx={{ mt: 3, mb: 1 }}>
                    <Typography variant="h6" color="primary" sx={{ fontSize: '1rem', fontWeight: 'bold' }}>
                        What does it mean?
                    </Typography>
                    <Typography variant="body1">
                        {errorAnalysis.mean}
                    </Typography>
                </Box>
            )}

            {errorAnalysis.do && (
                <Box sx={{ mt: 2 }}>
                    <Typography variant="h6" color="primary" sx={{ fontSize: '1rem', fontWeight: 'bold' }}>
                        What should I do?
                    </Typography>
                    <Typography variant="body1">
                        {errorAnalysis.do}
                    </Typography>
                </Box>
            )}
        </DialogContent>
        <DialogActions>
            <Button onClick={() => setSimError(null)} variant="contained" color="primary">
                Close
            </Button>
        </DialogActions>
      </Dialog>
    </ReplayContext.Provider>
  );
};