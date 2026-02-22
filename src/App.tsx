import { useState, useEffect, useCallback, useRef } from 'react';
import './index.css';
import { DeviceHealthCheck } from './pages/DeviceHealthCheck';
import { TestMode } from './pages/TestMode';
import { DataCollect } from './pages/DataCollect';
import { CameraView, QualityMetrics } from './components/CameraView';
import { ResultPanel } from './components/ResultPanel';
import { ComputerVision } from './services/ComputerVision';
import { PillDetector } from './services/PillDetector';
import { BatchProcessingResult, PipelineMetrics, InferenceResult, BoundingBox } from './services/Metrics';

// Assign detected boxes to bag columns by x position
function assignBoxesToBags(boxes: BoundingBox[], bagCount: number, expectedPerBag: number): InferenceResult[] {
  const bagWidth = 1.0 / bagCount;
  const bags: BoundingBox[][] = Array(bagCount).fill(null).map(() => []);
  for (const box of boxes) {
    const bagIdx = Math.min(bagCount - 1, Math.max(0, Math.floor(box.x / bagWidth)));
    bags[bagIdx].push(box);
  }
  return bags.map(bagBoxes => ({
    boxCount: bagBoxes.length,
    confidenceAverage: bagBoxes.length > 0 ? bagBoxes.reduce((s, b) => s + b.confidence, 0) / bagBoxes.length : 0,
    passedExpectedCount: bagBoxes.length === expectedPerBag,
    boxes: bagBoxes
  }));
}

type AppTab = '검수' | '테스트' | '데이터수집' | '진단';

type ScanState = 'INIT' | 'CAMERA' | 'SCANNING' | 'RESULT';

const STATE_LABELS: Record<ScanState, string> = {
  INIT: '초기화',
  CAMERA: '카메라',
  SCANNING: '분석중',
  RESULT: '결과',
};

const EXPECTED_PILLS = 10;
const BAG_COUNT = 10;

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

  // OpenCV init
  useEffect(() => {
    const handleReady = () => {
      if (scanState === 'INIT') setScanState('CAMERA');
    };
    if (window.cv && window.cv.Mat) {
      handleReady();
    } else {
      window.addEventListener('opencv-ready', handleReady);
    }
    return () => window.removeEventListener('opencv-ready', handleReady);
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

    // Capture the current frame
    const frameCanvas = latestFrameCanvas.current;
    if (!frameCanvas) {
      console.error('No frame canvas available');
      setScanState('CAMERA');
      return;
    }

    // Save captured image for display in results
    const captureUrl = frameCanvas.toDataURL('image/jpeg', 0.85);
    setCapturedImageUrl(captureUrl);
    const captureEnd = performance.now();

    // Run REAL OpenCV pill detection
    const allBoxes = PillDetector.detectFromCanvas(frameCanvas);
    const inferEnd = performance.now();

    console.log(`🔍 Detected ${allBoxes.length} pills in ${(inferEnd - captureEnd).toFixed(0)}ms`);

    // Assign boxes to bags by x position
    const bagResults = assignBoxesToBags(allBoxes, BAG_COUNT, EXPECTED_PILLS);

    const overallPass = bagResults.every(r => r.boxCount === EXPECTED_PILLS);
    const renderEnd = performance.now();

    const metrics: PipelineMetrics = {
      captureMs: captureEnd - start,
      warpMs: 0,
      inferMs: inferEnd - captureEnd,
      postprocessMs: renderEnd - inferEnd,
      renderMs: 1,
      totalMs: renderEnd - start
    };

    setResult({ results: bagResults, metrics, overallPass });
    setScanState('RESULT');
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
          <div className="viewport-wrapper">
            <CameraView isActive={true} onFrameReady={handleFrameReady} onQualityUpdate={setQuality} />
            <div className="camera-overlay">
              {!quality.isStable && getQualityKorean() && (
                <div className="quality-pill">{getQualityKorean()}</div>
              )}
              <button className="btn scan-btn" onClick={executeScan}>
                📸<br />촬영
              </button>
            </div>
          </div>
        );

      case 'SCANNING':
        return (
          <div className="viewport-wrapper">
            <div style={{ textAlign: 'center' }}>
              <h2 className="text-gradient" style={{ fontSize: '1.3rem' }}>분석 중...</h2>
              <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>알약 수량 확인 중</p>
            </div>
          </div>
        );

      case 'RESULT':
        return result ? (
          <ResultPanel result={result} expectedCount={EXPECTED_PILLS} imageUrl={capturedImageUrl || undefined} onRescan={() => setScanState('CAMERA')} />
        ) : null;

      default:
        return null;
    }
  };

  // Render active tab
  const renderContent = () => {
    switch (activeTab) {
      case '검수': return renderScanContent();
      case '테스트': return <TestMode />;
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
            {(['검수', '테스트', '데이터수집'] as AppTab[]).map(tab => (
              <button
                key={tab}
                className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === '검수' && scanState === 'RESULT') setScanState('CAMERA');
                }}
              >
                {tab === '검수' && '🔍 '}
                {tab === '테스트' && '🧪 '}
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
