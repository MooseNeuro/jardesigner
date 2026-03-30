import React, { useState, memo, useCallback, useEffect, useRef } from 'react'; 
import { Box, Tabs, Tab } from '@mui/material';
import GraphWindow from './GraphWindow';
import JsonText from './JsonText';
import MarkdownText from './MarkdownText';
import ThreeDViewer from './ThreeDViewer';
import ReactionGraph from './ReactionGraph'; 

const MemoizedGraphWindow = memo(GraphWindow);
const MemoizedJsonText = memo(JsonText);
const MemoizedMarkdownText = memo(MarkdownText);
const MemoizedReactionGraph = memo(ReactionGraph);

const DisplayWindow = (props) => {
  const {
    jsonContent,
    jsonData,
    setActiveMenu,
    plotDataUrl,
    isPlotReady,
    plotError,
    threeDConfigs,
    simulationFrames,
    drawableVisibility, setDrawableVisibility,
    clickSelected,
    explodeAxis,
    handleSelectionChange,
    onManagerReady,
    onExplodeAxisToggle,
    onSceneBuilt,
    handleStartReplay,
    handlePauseReplay,
    handleSeekReplay,
    clientId,
    isSimulating,
    reactionGraphs
  } = props;

  // ... (Keep all existing hooks/logic exactly as is) ...
  const [tabIndex, setTabIndex] = useState(0);
  const prevThreeDConfigSetup = useRef();
  const prevIsSimulating = useRef(false);

  useEffect(() => {
    const hasNewSetupConfig = threeDConfigs?.setup && !prevThreeDConfigSetup.current;
    if (hasNewSetupConfig) {
      setTabIndex(3);
    }
    prevThreeDConfigSetup.current = threeDConfigs?.setup;
  }, [threeDConfigs?.setup]);

  // When a run starts, switch to Graph if plots are defined, else Run 3D.
  useEffect(() => {
    if (!prevIsSimulating.current && isSimulating) {
      const hasPlots = jsonData?.plots?.length > 0;
      setTabIndex(hasPlots ? 0 : 4);
    }
    prevIsSimulating.current = isSimulating;
  }, [isSimulating, jsonData?.plots?.length]);

  const handleTabChange = (event, newValue) => {
    setTabIndex(newValue);
  };
  
  const setSetupDrawableVisibility = useCallback((updater) => {
      setDrawableVisibility(prev => ({ ...prev, setup: typeof updater === 'function' ? updater(prev.setup) : updater }));
  }, [setDrawableVisibility]);

  const setRunDrawableVisibility = useCallback((updater) => {
      setDrawableVisibility(prev => ({ ...prev, run: typeof updater === 'function' ? updater(prev.run) : updater }));
  }, [setDrawableVisibility]);

  const onManagerReadySetup = useCallback((manager) => onManagerReady('setup', manager), [onManagerReady]);
  const onSelectionChangeSetup = useCallback((selection, isCtrlClick) => handleSelectionChange('setup', selection, isCtrlClick), [handleSelectionChange]);
  const onExplodeAxisToggleSetup = useCallback((axis) => onExplodeAxisToggle('setup', axis), [onExplodeAxisToggle]);
  const onSceneBuiltSetup = useCallback((bbox) => onSceneBuilt('setup', bbox), [onSceneBuilt]);

  const onManagerReadyRun = useCallback((manager) => onManagerReady('run', manager), [onManagerReady]);
  const onSelectionChangeRun = useCallback((selection, isCtrlClick) => handleSelectionChange('run', selection, isCtrlClick), [handleSelectionChange]);
  const onExplodeAxisToggleRun = useCallback((axis) => onExplodeAxisToggle('run', axis), [onExplodeAxisToggle]);
  const onSceneBuiltRun = useCallback((bbox) => onSceneBuilt('run', bbox), [onSceneBuilt]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f5f5', borderRadius: '8px', overflow: 'hidden' }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Tabs value={tabIndex} onChange={handleTabChange} aria-label="display window tabs">
          <Tab label="Graph" />
          <Tab label="Model JSON" />
          <Tab label="Documentation" />
          <Tab label="Setup 3D" />
          <Tab label="Run 3D" />
          <Tab label="Reaction Graph" />
        </Tabs>
      </Box>

      {/* ... (Keep existing TabPanels 0-4) ... */}

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 1, display: tabIndex === 0 ? 'flex' : 'none' }}>
        <MemoizedGraphWindow plotDataUrl={plotDataUrl} isPlotReady={isPlotReady} plotError={plotError} />
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', display: tabIndex === 1 ? 'block' : 'none' }}>
        <MemoizedJsonText jsonString={jsonContent} setActiveMenu={setActiveMenu} />
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', display: tabIndex === 2 ? 'block' : 'none' }}>
        <MemoizedMarkdownText />
      </Box>
      
      <Box sx={{ flexGrow: 1, overflow: 'hidden', display: tabIndex === 3 ? 'flex' : 'none', flexDirection: 'column', position: 'relative' }}>
         {threeDConfigs?.setup && (
            <ThreeDViewer
              {...props}
              defaultDiaScale={2.5}
              threeDConfig={threeDConfigs.setup}
              simulationFrames={simulationFrames.setup}
              drawableVisibility={drawableVisibility.setup}
              setDrawableVisibility={setSetupDrawableVisibility}
              clickSelected={clickSelected.setup}
              explodeAxis={explodeAxis.setup}
              onManagerReady={onManagerReadySetup}
              onSelectionChange={onSelectionChangeSetup}
              onExplodeAxisToggle={onExplodeAxisToggleSetup}
              onSceneBuilt={onSceneBuiltSetup}
              isReplaying={false}
              onStartReplay={() => {}}
              onPauseReplay={() => {}}
              onSeekReplay={() => {}}
            />
        )}
      </Box>

      <Box sx={{ flexGrow: 1, overflow: 'hidden', display: tabIndex === 4 ? 'flex' : 'none', flexDirection: 'column', position: 'relative' }}>
        {threeDConfigs?.run && (
            <ThreeDViewer
              {...props}
              threeDConfig={threeDConfigs.run}
              simulationFrames={simulationFrames.run}
              drawableVisibility={drawableVisibility.run}
              setDrawableVisibility={setRunDrawableVisibility}
              clickSelected={clickSelected.run}
              explodeAxis={explodeAxis.run}
              onManagerReady={onManagerReadyRun}
              onSelectionChange={onSelectionChangeRun}
              onExplodeAxisToggle={onExplodeAxisToggleRun}
              onSceneBuilt={onSceneBuiltRun}
              onStartReplay={handleStartReplay}
              onPauseReplay={handlePauseReplay}
              onSeekReplay={handleSeekReplay}
            />
        )}
      </Box>

      {/* 2. REACTION GRAPH PANEL (Tab Index 5) */}
      <Box sx={{ flexGrow: 1, overflow: 'hidden', display: tabIndex === 5 ? 'flex' : 'none', position: 'relative' }}>
         <MemoizedReactionGraph 
             // Pass the Setup graph data specifically
             graphData={reactionGraphs?.setup} 
         />
      </Box>
    </Box>
  );
};

export default DisplayWindow;
