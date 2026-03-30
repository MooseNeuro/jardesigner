import React, { memo, useState, useEffect, useMemo, useRef } from 'react';
import { Box, Typography, Alert, CircularProgress } from '@mui/material';
import LandingGraphic from '../assets/LandingGraphic.png';
import Plot from 'react-plotly.js';

// --- CSS for Scaling Plotly Icons (2x) ---
const plotlyIconStyle = `
  .js-plotly-plot .plotly .modebar-btn {
      transform: scale(2);
      margin-left: 12px !important;
      margin-right: 12px !important;
  }
  .js-plotly-plot .plotly .modebar {
      top: 8px !important;
      right: 8px !important;
  }
`;

// --- Utility: Resize Observer Hook ---
// This measures the exact size of the container so we can tell Plotly
// exactly how big to be, preventing the "pop" effect.
const useContainerSize = () => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
};

// --- Utility: Download CSV ---
const downloadCSV = (plotData) => {
    if (!plotData || !plotData.val) return;
    const dt = plotData.dt;
    const numPoints = plotData.val[0].length;
    
    // Header
    let csvContent = "Time," + plotData.val.map((_, i) => `Trace_${i+1}`).join(",") + "\n";
    
    // Rows
    for (let i = 0; i < numPoints; i++) {
        const t = i * dt;
        const row = [t, ...plotData.val.map(trace => trace[i])].join(",");
        csvContent += row + "\n";
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${plotData.title || 'plot'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// --- Sub-component: Single Plot ---
const SinglePlot = ({ plotData }) => {
  const { ref, width, height } = useContainerSize();

  // Legend visibility — default on when there are multiple sub-plots
  const [showLegend, setShowLegend] = useState(() => plotData?.numSubPlots > 1);

  // Ref so the modebar button click handler always calls the latest toggle
  // without needing to be recreated on every render.
  const toggleLegendRef = useRef();
  toggleLegendRef.current = () => setShowLegend(v => !v);

  // Prepare Data for Plotly
  const { traces, layout } = useMemo(() => {
    if (!plotData || !plotData.val) return { traces: [], layout: {} };

    const dt = plotData.dt;
    const numPoints = plotData.val[0].length;

    // Generate X-axis (Time) ONCE
    const timeArray = new Float32Array(numPoints);
    for(let i=0; i<numPoints; i++) timeArray[i] = i * dt;

    // Create Traces
    const traces = plotData.val.map((yData, i) => ({
      x: timeArray,
      y: yData,
      type: 'scatter',
      mode: 'lines',
      name: `Trace ${i + 1}`,
      line: { width: 3 }
    }));

    // Layout Config
    const layout = {
      // Explicitly set dimensions to match container
      width: width,
      height: height,
      title: {
          text: plotData.title,
          font: { size: 28, weight: 'bold' }
      },
      xaxis: {
        title: {
            text: plotData.xlabel,
            font: { size: 28 }
        },
        tickfont: { size: 24 },
        ticks: 'outside',
        ticklen: 8,
        tickwidth: 2,
        showline: true,
        linewidth: 2,
        automargin: true,
        zeroline: true,
      },
      yaxis: {
        title: {
            text: plotData.ylabel,
            font: { size: 28 }
        },
        tickfont: { size: 24 },
        ticks: 'outside',
        ticklen: 8,
        tickwidth: 2,
        showline: true,
        linewidth: 2,
        automargin: true,
        zeroline: true,
      },
      font: { family: 'Arial, sans-serif', size: 20 },
      margin: { l: 80, r: 40, b: 80, t: 60 },
      showlegend: showLegend,
      autosize: false, // We handle sizing manually
      legend: {
          font: { size: 20 }
      }
    };

    return { traces, layout };
  }, [plotData, width, height, showLegend]);

  const config = useMemo(() => ({
      responsive: false, // Turned off because we are handling it manually
      displaylogo: false,
      modeBarButtonsToAdd: [
        {
          // Toggle legend visibility. Icon: 3 rows of colour-swatch + label line.
          name: 'Toggle Legend',
          icon: {
            width: 512, height: 512,
            path: 'M32 144 h64 v64 H32 Z M128 160 h352 v32 H128 Z M32 272 h64 v64 H32 Z M128 288 h352 v32 H128 Z M32 400 h64 v64 H32 Z M128 416 h352 v32 H128 Z'
          },
          click: () => toggleLegendRef.current()
        },
        {
          name: 'Download CSV',
          icon: {
            width: 512, height: 512,
            path: "M448 192V77.25c0-8.49-3.37-16.62-9.37-22.63L393.37 9.37c-6-6-9.37-14.14-9.37-22.63H96C78.33 0 64 14.33 64 32v384c0 17.67 14.33 32 32 32h320c17.67 0 32-14.33 32-32V192h-64zM64 416V32h288v96h96v288H64zm170.3-138.9l-67.9 67.9V192c0-8.8-7.2-16-16-16s-16 7.2-16 16v152.1l-67.9-67.9c-6.2-6.2-16.4-6.2-22.6 0s-6.2 16.4 0 22.6l96 96c6.2 6.2 16.4 6.2 22.6 0l96-96c6.2-6.2 6.2-16.4 0-22.6s-16.4-6.2-22.6 0z"
          },
          click: () => downloadCSV(plotData)
        }
      ]
  }), [plotData]);

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
        {/* Only render Plot if we have valid dimensions to prevent 0x0 errors */}
        {width > 0 && height > 0 && (
            <Plot
              data={traces}
              layout={layout}
              config={config}
              useResizeHandler={false}
              style={{ width: '100%', height: '100%' }}
            />
        )}
    </div>
  );
};

const GraphWindow = memo(({ plotDataUrl, isPlotReady, plotError }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    if (isPlotReady && plotDataUrl) {
        setLoading(true);
        setFetchError(null);
        fetch(plotDataUrl)
            .then(res => {
                if (!res.ok) throw new Error("Failed to fetch plot data");
                return res.json();
            })
            .then(jsonData => {
                setData(jsonData);
                setLoading(false);
            })
            .catch(err => {
                console.error("Error loading plot json:", err);
                setFetchError(err.message);
                setLoading(false);
            });
    } else {
        setData(null);
    }
  }, [isPlotReady, plotDataUrl]);

  // CSS Grid Layout
  const gridStyle = useMemo(() => {
      if (!data) return {};
      return {
          display: 'grid',
          // Use minmax(0, 1fr) to force strict size containment
          gridTemplateColumns: `repeat(${data.ncols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${data.nrows}, minmax(0, 1fr))`,
          gap: '15px',
          height: '90%',
          width: '100%',
          padding: '10px',
          boxSizing: 'border-box',
          overflow: 'hidden' // Ensure nothing spills out
      };
  }, [data]);

  return (
    <Box
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden' // Parent container must also clip overflow
      }}
    >
      <style>{plotlyIconStyle}</style>
      
      <Typography variant="h6" gutterBottom sx={{ flexShrink: 0, px: 2, pt: 1 }}>
        Graph Display
      </Typography>

      {(plotError || fetchError) && (
        <Alert severity="error" sx={{ mb: 2, mx: 2, flexShrink: 0 }}>
          Error: {plotError || fetchError}
        </Alert>
      )}

      <Box
        sx={{
          flexGrow: 1,
          background: '#fff',
          borderRadius: '4px',
          overflow: 'hidden',
          minHeight: 0, // Flex item fix
          position: 'relative',
        }}
      >
        {isPlotReady && data && !loading && (
             <div style={gridStyle}>
                {data.plots.map((plot, index) => (
                    <Box key={index} sx={{ 
                        width: '100%', 
                        height: '100%', 
                        border: '1px solid #ddd', 
                        borderRadius: '4px',
                        overflow: 'hidden',
                        position: 'relative'
                    }}>
                        <SinglePlot plotData={plot} />
                    </Box>
                ))}
             </div>
        )}

        {loading && (
             <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', width: '100%' }}>
                 <CircularProgress sx={{ mb: 2 }}/>
                 <Typography>Loading plot data...</Typography>
             </Box>
        )}

        {!isPlotReady && !plotError && !loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%' }}>
            <img
              src={LandingGraphic}
              alt="Jardesigner Landing Graphic"
              style={{
                objectFit: 'contain',
                maxWidth: '80%',
                maxHeight: '80%',
              }}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
});

export default GraphWindow;
