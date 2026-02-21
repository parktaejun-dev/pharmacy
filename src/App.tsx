import { useState, useEffect, useCallback } from 'react';
import './index.css';
import { DeviceHealthCheck } from './pages/DeviceHealthCheck';
import { TestMode } from './pages/TestMode';
import { DataCollect } from './pages/DataCollect';
import { CameraView, QualityMetrics } from './components/CameraView';
import { ResultPanel } from './components/ResultPanel';
import { ComputerVision } from './services/ComputerVision';
import { MvpInferenceService } from './services/Inference';
import { BatchProcessingResult, PipelineMetrics } from './services/Metrics';

type AppTab = '검수' | '테스트' | '데이터수집' | '진단';

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
    const inferenceResult = await MvpInferenceService.runTrackAStub(10);
    const end = performance.now();

    const metrics: PipelineMetrics = {
      ...inferenceResult.metrics,
      captureMs: 12.4,
      warpMs: 18.2,
      totalMs: end - start + 30.6
    };

    setResult({ ...inferenceResult, metrics });
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
        return (
          <div className="viewport-wrapper" style={{ alignItems: 'stretch' }}>
            {result && <ResultPanel result={result} expectedCount={10} onRescan={() => setScanState('CAMERA')} />}
          </div>
        );

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
