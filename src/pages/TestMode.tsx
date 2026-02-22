import React, { useState, useRef, useEffect } from 'react';
import { BatchProcessingResult } from '../services/Metrics';
import { ResultPanel } from '../components/ResultPanel';
import { MvpInferenceService } from '../services/Inference';
import { ComputerVision } from '../services/ComputerVision';

interface TestSample {
    id: string;
    name: string;
    imageUrl: string;
    description: string;
    label: '정상' | '이상';
}

const TEST_SAMPLES: TestSample[] = [
    {
        id: 'normal_6',
        name: '정상 세트 (6알×10봉지)',
        imageUrl: '/testset/normal_5pills.png', // The file name says 5 but the image contains 6
        description: '10봉지 모두 6알씩 정상 포장',
        label: '정상'
    },
    {
        id: 'fail_missing',
        name: '이상 세트 (알약 부족)',
        imageUrl: '/testset/fail_missing_pills.png',
        description: '일부 봉지에 알약 부족 — 이상 감지 테스트',
        label: '이상'
    }
];

export const TestMode: React.FC = () => {
    const [selectedSample, setSelectedSample] = useState<TestSample | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState<BatchProcessingResult | null>(null);
    const [isEngineReady, setIsEngineReady] = useState(false);
    const [croppedImageUrl, setCroppedImageUrl] = useState<string | null>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    const runTest = (sample: TestSample) => {
        setSelectedSample(sample);
        setIsRunning(true);
        setResult(null);
    };

    useEffect(() => {
        // Initialize the ONNX session
        MvpInferenceService.init().then(() => {
            setIsEngineReady(true);
        }).catch(console.error);
    }, []);

    useEffect(() => {
        if (!isRunning || !selectedSample || !imgRef.current || !isEngineReady) return;

        const img = imgRef.current;
        const handleLoad = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                setIsRunning(false);
                return;
            }
            // Draw the image first so OpenCV can analyze the pixels
            ctx.fillStyle = '#C0C0C0'; // Neutral background for transparent PNGs
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);

            // Dynamically detect the pill bag region
            let cropX = 0, cropY = 0, cropW = canvas.width, cropH = canvas.height;
            const roi = ComputerVision.findPillBagRegion(canvas);

            if (roi) {
                cropX = roi.x;
                cropY = roi.y;
                cropW = roi.w;
                cropH = roi.h;
            } else {
                // Fallback
                cropW = canvas.width * 0.95;
                cropH = canvas.height * 0.65;
                cropX = (canvas.width - cropW) / 2;
                cropY = (canvas.height - cropH) / 2;
            }

            const croppedCanvas = document.createElement('canvas');
            croppedCanvas.width = cropW;
            croppedCanvas.height = cropH;
            const ctx2 = croppedCanvas.getContext('2d');

            if (!ctx2) {
                setIsRunning(false);
                return;
            }

            // Fill neutral background for final cropped image fed to YOLO
            ctx2.fillStyle = '#C0C0C0';
            ctx2.fillRect(0, 0, cropW, cropH);
            ctx2.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

            setCroppedImageUrl(croppedCanvas.toDataURL('image/jpeg', 0.9));

            // Yield the event loop slightly to ensure React paints the loading overlay before aggressive WASM block
            setTimeout(async () => {
                try {
                    const yoloResult = await MvpInferenceService.runTrackBYolo(croppedCanvas);
                    const numBags = yoloResult.results.length;
                    console.log(`Detected pills across ${numBags} bags.`);

                    setResult(yoloResult);
                } catch (err) {
                    console.error("YOLO Inference failed", err);
                }
                setIsRunning(false);
            }, 100);
        };

        if (img.complete && img.naturalWidth > 0) {
            handleLoad();
        } else {
            img.onload = handleLoad;
        }
    }, [isRunning, selectedSample, isEngineReady]);

    if (result && selectedSample) {
        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 20 }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        테스트: <strong style={{ color: 'var(--text-primary)' }}>{selectedSample.name}</strong>
                        <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: 'var(--accent-blue)' }}>
                            (YOLOv8 AI 활성화됨)
                        </span>
                    </span>
                    <button className="btn" style={{ padding: '4px 12px', fontSize: '0.8rem', background: 'var(--panel-bg)' }}
                        onClick={() => { setResult(null); setSelectedSample(null); }}>
                        ← 목록으로
                    </button>
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                    <ResultPanel
                        result={result}
                        expectedCount={result.expectedPerBag || 0}
                        imageUrl={croppedImageUrl || selectedSample.imageUrl}
                        onRescan={() => { setResult(null); setSelectedSample(null); setCroppedImageUrl(null); }}
                    />
                </div>
            </div>
        );
    }

    return (
        <div style={{ height: '100%', overflow: 'auto', padding: '16px' }}>
            <div style={{ marginBottom: '16px' }}>
                <h2 style={{ fontSize: '1.1rem', marginBottom: '4px' }}>🧪 테스트 모드</h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    ONNX Runtime과 AI 모델(YOLOv8)로 비전 검수를 <strong>실시간 수행</strong>합니다
                </p>
            </div>

            {isRunning && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
                    backgroundColor: 'rgba(0, 0, 0, 0.8)', zIndex: 9999,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center'
                }}>
                    <img ref={imgRef} src={selectedSample?.imageUrl}
                        crossOrigin="anonymous"
                        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                        alt="detection source" />

                    <div style={{
                        width: '60px', height: '60px', borderRadius: '50%',
                        border: '4px solid rgba(255,255,255,0.1)',
                        borderTopColor: 'var(--accent-blue)',
                        animation: 'spin 1s linear infinite',
                        marginBottom: '20px'
                    }} />

                    <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'white', marginBottom: '8px' }}>
                        {!isEngineReady ? '⏳ AI 엔진 로딩 및 워밍업 중...' : '🔍 고해상도 비전 추론 중...'}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#aaa', textAlign: 'center', maxWidth: '300px' }}>
                        {!isEngineReady
                            ? '첫 실행 시 모델 다운로드(42MB) 및 물리 메모리 할당으로 최대 30초가 소요될 수 있습니다.'
                            : '글로벌 초정밀 AI 모델이 구동 중입니다. 기기 성능에 따라 15~30초가 소요됩니다.'}
                    </div>
                    <style>{`
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    `}</style>
                </div>
            )}

            {!isRunning && (
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    {TEST_SAMPLES.map(sample => (
                        <div key={sample.id} className="glass-panel" style={{
                            width: 'calc(50% - 6px)',
                            overflow: 'hidden',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            border: `1px solid ${sample.label === '정상' ? 'var(--accent-green)' : 'var(--accent-red)'}`
                        }}
                            onClick={() => runTest(sample)}
                        >
                            <img src={sample.imageUrl} alt={sample.name}
                                style={{ width: '100%', height: '120px', objectFit: 'cover' }} />
                            <div style={{ padding: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{sample.name}</span>
                                    <span style={{
                                        padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600,
                                        background: sample.label === '정상' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                                        color: sample.label === '정상' ? 'var(--accent-green)' : 'var(--accent-red)'
                                    }}>
                                        {sample.label}
                                    </span>
                                </div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                                    {sample.description}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
