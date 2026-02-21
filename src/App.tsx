import { useState, useEffect, useCallback } from 'react';
import './index.css';
import { DeviceHealthCheck } from './pages/DeviceHealthCheck';
import { CameraView, QualityMetrics } from './components/CameraView';
import { CalibrationGrid } from './components/CalibrationGrid';
import { ResultPanel } from './components/ResultPanel';
import { ComputerVision } from './services/ComputerVision';
import { MvpInferenceService } from './services/Inference';
import { BatchProcessingResult, PipelineMetrics } from './services/Metrics';

// Define strict State Machine states
type AppState =
  | 'INIT'
  | 'CAMERA_READY'
  | 'CALIBRATING'
  | 'READY_TO_SCAN'
  | 'SCANNING'
  | 'RESULT'
  | 'RESCAN'
  | 'DIAGNOSTICS';

function App() {
  const [appState, setAppState] = useState<AppState>('INIT');
  const [frameCanvas, setFrameCanvas] = useState<HTMLCanvasElement | null>(null);
  const [quality, setQuality] = useState<QualityMetrics>({ isStable: false, glareScore: 0, blurScore: 0 });
  // Removed unused warpedCanvas
  const [result, setResult] = useState<BatchProcessingResult | null>(null);

  // Wait for OpenCV initialization before transitioning out of INIT
  useEffect(() => {
    const handleOpenCVReady = () => {
      console.log('OpenCV.js is fully loaded and ready');
      if (appState === 'INIT') {
        setAppState('CAMERA_READY');
      }
    };

    if (window.cv && window.cv.Mat) {
      handleOpenCVReady();
    } else {
      window.addEventListener('opencv-ready', handleOpenCVReady);
    }

    return () => window.removeEventListener('opencv-ready', handleOpenCVReady);
  }, [appState]);

  const handleFrameReady = useCallback((canvas: HTMLCanvasElement) => {
    // Only evaluate quality if we are looking to scan or calibrate
    if (appState === 'CAMERA_READY' || appState === 'READY_TO_SCAN') {
      const q = ComputerVision.evaluateQualityGate(canvas);
      setQuality(q);
      setFrameCanvas(canvas); // Keep latest
    }
  }, [appState]);

  const startCalibration = () => {
    if (!quality.isStable) {
      alert(quality.rejectionReason || "Please stabilize the camera before calibrating.");
      return;
    }
    setAppState('CALIBRATING');
  };

  const handleWarpComplete = (_warped: HTMLCanvasElement) => {
    // setWarpedCanvas(warped); // Removing if unused in UI
    setAppState('READY_TO_SCAN');
  };

  const executeTrackAScan = async () => {
    // QUALITY GATE: BLOCKS execution if blurry or glaring
    if (!quality.isStable) {
      alert(quality.rejectionReason || "Environment not stable enough to scan.");
      setAppState('RESCAN');
      return;
    }

    setAppState('SCANNING');
    const startOverall = performance.now();

    // Fake the capture & warp timers to demonstrate MS logging
    const captureMs = 12.4;
    const warpMs = 18.2;

    // Execute Inference (Track A stub)
    const inferenceResult = await MvpInferenceService.runTrackAStub(10); // Assume expected count = 10 per bag

    const endOverall = performance.now();

    const finalMetrics: PipelineMetrics = {
      ...inferenceResult.metrics,
      captureMs,
      warpMs,
      totalMs: endOverall - startOverall + captureMs + warpMs
    };

    setResult({ ...inferenceResult, metrics: finalMetrics });
    setAppState('RESULT');
  };

  const renderContent = () => {
    switch (appState) {
      case 'INIT':
        return (
          <div className="viewport-wrapper">
            <h2 className="text-gradient">Initializing AI Scanner...</h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>Waiting for OpenCV & ORT engines</p>
          </div>
        );

      case 'DIAGNOSTICS':
        return <DeviceHealthCheck />;

      case 'CAMERA_READY':
        return (
          <div className="viewport-wrapper">
            <CameraView
              isActive={true}
              onFrameReady={handleFrameReady}
              onQualityUpdate={setQuality}
            />
            {/* Overlay UI */}
            <div style={{ position: 'absolute', bottom: '40px', left: 0, right: 0, textAlign: 'center' }}>
              {!quality.isStable && (
                <div style={{ background: 'rgba(239, 68, 68, 0.9)', color: 'white', padding: '8px', marginBottom: '16px', borderRadius: '4px', display: 'inline-block' }}>
                  {quality.rejectionReason}
                </div>
              )}
              <br />
              <button
                className="btn"
                onClick={startCalibration}
                disabled={!quality.isStable}
                style={{ background: quality.isStable ? 'var(--accent-blue)' : '#555' }}
              >
                {quality.isStable ? 'Start Calibration' : 'Stabilizing...'}
              </button>
            </div>
          </div>
        );

      case 'CALIBRATING':
        return (
          <div className="viewport-wrapper" style={{ background: '#000', zIndex: 50 }}>
            {frameCanvas && <CalibrationGrid
              initialCanvas={frameCanvas}
              onWarpComplete={handleWarpComplete}
              onRetake={() => setAppState('CAMERA_READY')}
            />}
          </div>
        );

      case 'READY_TO_SCAN':
      case 'RESCAN':
        return (
          <div className="viewport-wrapper">
            <CameraView
              isActive={true}
              onFrameReady={handleFrameReady}
              onQualityUpdate={setQuality}
            />
            <div style={{ position: 'absolute', bottom: '40px', left: 0, right: 0, textAlign: 'center' }}>
              {!quality.isStable && (
                <div style={{ background: 'rgba(239, 68, 68, 0.9)', color: 'white', padding: '8px', marginBottom: '16px', borderRadius: '4px', display: 'inline-block' }}>
                  {quality.rejectionReason}
                </div>
              )}
              <br />
              <button
                className="btn"
                onClick={executeTrackAScan}
                disabled={!quality.isStable}
                style={{ background: quality.isStable ? 'var(--accent-green)' : '#555', fontSize: '1.2rem', padding: '16px 32px' }}
              >
                {quality.isStable ? 'Scan 10 Bags' : 'Waiting for clear frame...'}
              </button>

              <div style={{ marginTop: '20px' }}>
                <button
                  className="btn"
                  onClick={() => setAppState('CAMERA_READY')}
                  style={{ background: 'transparent', border: '1px solid var(--panel-border)', fontSize: '0.9rem' }}
                >
                  Recalibrate Grid
                </button>
              </div>
            </div>
          </div>
        );

      case 'SCANNING':
        return (
          <div className="viewport-wrapper">
            <h2 className="text-gradient">Processing Image...</h2>
            <p style={{ color: 'var(--text-secondary)' }}>Extracting ROI & Running Inference</p>
          </div>
        );

      case 'RESULT':
        return (
          <div className="viewport-wrapper" style={{ alignItems: 'flex-start', paddingTop: '60px' }}>
            {result && <ResultPanel
              result={result}
              expectedCount={10}
              onRescan={() => setAppState('READY_TO_SCAN')}
            />}
          </div>
        );

      default:
        return null;
    }
  };

  const getStatusClass = (state: AppState) => {
    if (state === 'INIT') return 'status-init';
    if (state === 'CAMERA_READY' || state === 'READY_TO_SCAN') return 'status-ready';
    if (state === 'CALIBRATING') return 'status-calibrating';
    if (state === 'SCANNING') return 'status-scanning';
    if (state === 'RESCAN' || state === 'RESULT') return 'status-error';
    if (state === 'DIAGNOSTICS') return 'status-calibrating';
    return 'status-init';
  };

  return (
    <div className="app-container">
      {/* Header bar */}
      <header className="header">
        <h1>AI Pill Inspection <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>MVP</span></h1>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span className={`status - badge ${getStatusClass(appState)} `}>
            {appState.replace('_', ' ')}
          </span>

          <button
            className="btn"
            style={{ padding: '6px 12px', fontSize: '0.8rem', background: 'transparent', border: '1px solid var(--panel-border)' }}
            onClick={() => setAppState(appState === 'DIAGNOSTICS' ? 'INIT' : 'DIAGNOSTICS')}
          >
            {appState === 'DIAGNOSTICS' ? 'Close Diagnostics' : 'Check Health'}
          </button>
        </div>
      </header>

      {/* Dynamic Content */}
      <main className="main-content">
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
