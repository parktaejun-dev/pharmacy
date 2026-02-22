import { useState, useEffect, useCallback, useRef } from 'react';
import './index.css';
import { DeviceHealthCheck } from './pages/DeviceHealthCheck';
import { DataCollect } from './pages/DataCollect';
import { CameraView, QualityMetrics } from './components/CameraView';
import { ResultPanel } from './components/ResultPanel';
import { ComputerVision } from './services/ComputerVision';
import { BatchProcessingResult } from './services/Metrics';
import { MvpInferenceService } from './services/Inference';

type AppTab = '검수' | '데이터수집' | '진단';
type ScanState = 'INIT' | 'CAMERA' | 'SCANNING' | 'RESULT';

const STATE_LABELS: Record<ScanState, string> = {
  INIT: '초기화',
  CAMERA: '카메라',
  SCANNING: '분석중',
  RESULT: '결과',
};


function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('검수');
  const [scanState, setScanState] = useState<ScanState>('INIT');
  const [quality, setQuality] = useState<QualityMetrics>({ isStable: false, glareScore: 0, blurScore: 0 });
  const [result, setResult] = useState<BatchProcessingResult | null>(null);
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null);
  const latestFrameCanvas = useRef<HTMLCanvasElement | null>(null);

  // Landscape lock
  useEffect(() => {
    try {
      const sl = screen.orientation as any;
      if (sl?.lock) sl.lock('landscape').catch(() => { });
    } catch (_) { }
  }, []);

  useEffect(() => {
    if (scanState === 'INIT') {
      const initEngines = async () => {
        try {
          // Initialize OpenCV
          if (!window.cv || !window.cv.Mat) {
            await new Promise<void>((resolve) => {
              window.addEventListener('opencv-ready', () => resolve(), { once: true });
            });
          }
          // Initialize ONNX model globally
          await MvpInferenceService.init();
          setScanState('CAMERA');
        } catch (error) {
          console.error('Failed to initialize engines', error);
        }
      };
      initEngines();
    }
  }, [scanState]);

  const handleFrameReady = useCallback((canvas: HTMLCanvasElement) => {
    // Store latest frame for capture
    latestFrameCanvas.current = canvas;
    if (scanState === 'CAMERA') {
      const q = ComputerVision.evaluateQualityGate(canvas);
      setQuality(q);
    }
  }, [scanState]);

  const getQualityKorean = (): string | undefined => {
    if (!quality.rejectionReason) return undefined;
    if (quality.rejectionReason.includes('blurry')) return '📷 흔들림 — 고정해주세요';
    if (quality.rejectionReason.includes('glare')) return '💡 빛반사 — 각도 조절';
    if (quality.rejectionReason.includes('CV not loaded')) return '⏳ 로딩중...';
    return quality.rejectionReason;
  };

  const executeScan = async () => {
    setScanState('SCANNING');
    const start = performance.now();

    const frameCanvas = latestFrameCanvas.current;
    if (!frameCanvas) {
      console.error('No frame canvas available');
      setScanState('CAMERA');
      return;
    }

    // Dynamically detect the pill bag region to eliminate background noise accurately
    let cropX = 0, cropY = 0, cropW = frameCanvas.width, cropH = frameCanvas.height;
    const roi = ComputerVision.findPillBagRegion(frameCanvas);

    if (roi) {
      cropX = roi.x;
      cropY = roi.y;
      cropW = roi.w;
      cropH = roi.h;
    } else {
      // Fallback to a loose central crop if OpenCV contour detection fails
      cropW = frameCanvas.width * 0.95;
      cropH = frameCanvas.height * 0.65;
      cropX = (frameCanvas.width - cropW) / 2;
      cropY = (frameCanvas.height - cropH) / 2;
    }

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const ctx = croppedCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, cropW, cropH);
      ctx.drawImage(frameCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    }

    // Save captured image for display in results
    const captureUrl = croppedCanvas.toDataURL('image/jpeg', 0.85);
    setCapturedImageUrl(captureUrl);

    // Yield control to the browser so the "SCANNING" overlay can render before WASM blocks the thread
    setTimeout(async () => {
      try {
        const yoloResult = await MvpInferenceService.runTrackBYolo(croppedCanvas);
        // Include capture Ms to complete the pipeline metric
        yoloResult.metrics.captureMs = performance.now() - start;
        yoloResult.metrics.totalMs = yoloResult.metrics.captureMs + yoloResult.metrics.inferMs + yoloResult.metrics.postprocessMs;

        let totalPills = 0;
        let numBags = yoloResult.results.length;
        yoloResult.results.forEach(r => totalPills += r.boxCount);
        console.log(`🔍 ${totalPills} pills → ${numBags} bags: expected = ${yoloResult.expectedPerBag} `);

        setResult(yoloResult);
        setScanState('RESULT');
      } catch (err) {
        console.error("YOLO Inference failed", err);
        setScanState('CAMERA');
        alert("추론 엔진 오류가 발생했습니다. 기기 진단을 확인해주세요.");
      }
    }, 100);
  };

  // Render scan tab content
  const renderScanContent = () => {
    switch (scanState) {
      case 'INIT':
        return (
          <div className="viewport-wrapper">
            <div style={{ textAlign: 'center' }}>
              <h2 className="text-gradient" style={{ fontSize: '1.2rem' }}>AI 약봉지 검수</h2>
              <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: '0.9rem' }}>엔진 로딩중...</p>
            </div>
          </div>
        );

      case 'CAMERA':
        return (
          <div className="result-container" style={{ paddingTop: '60px' }}>
            <div className="result-left" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px', border: '1px solid var(--panel-border)', background: '#000' }}>
              <CameraView isActive={true} onFrameReady={handleFrameReady} onQualityUpdate={setQuality} />
              <div style={{ position: 'absolute', bottom: '20px', left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                {!quality.isStable && getQualityKorean() && (
                  <div className="quality-pill" style={{ background: 'rgba(239, 68, 68, 0.9)', padding: '6px 16px', borderRadius: '20px', fontWeight: 'bold' }}>
                    {getQualityKorean()}
                  </div>
                )}
              </div>
            </div>
            <div className="result-right" style={{ justifyContent: 'center', alignItems: 'center' }}>
              <div className="glass-panel" style={{ width: '100%', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', margin: 0 }}>
                  화면 영역에 봉지를 맞추고<br />촬영 버튼을 누르세요
                </p>
                <button className="btn scan-btn" onClick={executeScan} disabled={!quality.isStable}
                  style={{
                    width: '100px', height: '100px', borderRadius: '50%', fontSize: '1.2rem', padding: 0,
                    boxShadow: '0 4px 12px rgba(59,130,246,0.4)', border: '4px solid rgba(255,255,255,0.2)'
                  }}>
                  📸<br />촬영
                </button>
              </div>
            </div>
          </div>
        );

      case 'SCANNING':
        return (
          <div className="result-container" style={{ paddingTop: '60px' }}>
            <div className="result-left" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px', border: '1px solid var(--panel-border)', background: '#000' }}>
              <img src={capturedImageUrl || undefined} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Captured frame" />
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.8)', zIndex: 9999,
                display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center'
              }}>
                <div style={{
                  width: '60px', height: '60px', borderRadius: '50%',
                  border: '4px solid rgba(255,255,255,0.1)',
                  borderTopColor: 'var(--accent-blue)',
                  animation: 'spin 1s linear infinite',
                  marginBottom: '20px'
                }} />
                <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'white', marginBottom: '8px' }}>
                  🔍 고해상도 비전 추론 중...
                </div>
                <div style={{ fontSize: '0.9rem', color: '#aaa', textAlign: 'center', maxWidth: '300px' }}>
                  초정밀 AI 모델이 구동 중입니다. <br />스마트폰 성능에 따라 15~30초가 소요됩니다.
                </div>
                <style>{`
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                `}</style>
              </div>
            </div>
            <div className="result-right" style={{ justifyContent: 'center', alignItems: 'center' }}>
              <div className="glass-panel" style={{ width: '100%', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', margin: 0 }}>
                  분석을 진행하고 있습니다.<br />잠시만 기다려주세요.
                </p>
                <div style={{ width: '100px', height: '100px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ⏳
                </div>
              </div>
            </div>
          </div>
        );

      case 'RESULT':
        return result ? (
          <ResultPanel result={result} expectedCount={result.expectedPerBag || 0} imageUrl={capturedImageUrl || undefined} onRescan={() => setScanState('CAMERA')} />
        ) : null;

      default:
        return null;
    }
  };

  // Render active tab
  const renderContent = () => {
    switch (activeTab) {
      case '검수': return renderScanContent();
      case '데이터수집': return <DataCollect />;
      case '진단': return <DeviceHealthCheck />;
    }
  };

  return (
    <>
      {/* Portrait warning */}
      <div className="portrait-warning">
        <div className="rotate-icon">📱</div>
        <p><strong>가로 모드</strong>로 전환해주세요</p>
        <p style={{ fontSize: '0.9rem' }}>약봉지가 가로로 배열되어 있어<br />가로 모드에서 최적으로 작동합니다</p>
      </div>

      <div className="app-container">
        {/* Header with tabs */}
        <header className="header">
          <h1 style={{ whiteSpace: 'nowrap' }}>💊 약봉지 검수</h1>

          {/* Tab navigation */}
          <nav className="tab-nav">
            {(['검수', '데이터수집'] as AppTab[]).map(tab => (
              <button
                key={tab}
                className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === '검수' && scanState === 'RESULT') setScanState('CAMERA');
                }}
              >
                {tab === '검수' && '🔍 '}
                {tab === '데이터수집' && '📷 '}
                {tab}
              </button>
            ))}
          </nav>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {activeTab === '검수' && (
              <span className={`status-badge ${scanState === 'INIT' ? 'status-init' : scanState === 'CAMERA' ? 'status-ready' : scanState === 'SCANNING' ? 'status-scanning' : 'status-error'}`}>
                {STATE_LABELS[scanState]}
              </span>
            )}
            <button className="btn"
              style={{ padding: '3px 8px', fontSize: '0.7rem', background: 'transparent', border: '1px solid var(--panel-border)' }}
              onClick={() => setActiveTab(activeTab === '진단' ? '검수' : '진단')}>
              {activeTab === '진단' ? '닫기' : '⚙'}
            </button>
          </div>
        </header>

        <main className="main-content">
          {renderContent()}
        </main>
      </div>
    </>
  );
}

export default App;
