import React, { useState, useRef, useEffect } from 'react';
import { PillDetector } from '../services/PillDetector';
import { BatchProcessingResult, PipelineMetrics, InferenceResult } from '../services/Metrics';
import { ResultPanel } from '../components/ResultPanel';

interface TestSample {
    id: string;
    name: string;
    imageUrl: string;
    description: string;
    label: '정상' | '이상';
}

const TEST_SAMPLES: TestSample[] = [
    {
        id: 'normal_5',
        name: '정상 세트 (5알×10봉지)',
        imageUrl: '/testset/normal_5pills.png',
        description: '10봉지 모두 5알씩 정상 포장',
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
    const [detectionLog, setDetectionLog] = useState<string>('');
    const imgRef = useRef<HTMLImageElement>(null);

    const runTest = (sample: TestSample) => {
        setSelectedSample(sample);
        setIsRunning(true);
        setResult(null);
        setDetectionLog('이미지 로딩 중...');
    };

    useEffect(() => {
        if (!isRunning || !selectedSample || !imgRef.current) return;

        const img = imgRef.current;
        const handleLoad = () => {
            setDetectionLog('OpenCV 감지 실행 중...');
            const startTime = performance.now();

            // Real OpenCV detection
            const allBoxes = PillDetector.detectFromImage(img);
            const inferEnd = performance.now();

            // Cluster into bags by x-coordinate gaps
            const clusters = PillDetector.clusterIntoBags(allBoxes);

            // Auto-detect expected count = mode (most common count)
            const counts = clusters.map(c => c.length);
            const freq: Record<number, number> = {};
            counts.forEach(c => freq[c] = (freq[c] || 0) + 1);
            const autoExpected = Object.entries(freq).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0];
            const expectedPerBag = autoExpected ? parseInt(autoExpected) : 0;

            const bagResults: InferenceResult[] = clusters.map(bagBoxes => ({
                boxCount: bagBoxes.length,
                confidenceAverage: bagBoxes.length > 0 ? bagBoxes.reduce((s, b) => s + b.confidence, 0) / bagBoxes.length : 0,
                passedExpectedCount: bagBoxes.length === expectedPerBag,
                boxes: bagBoxes
            }));

            const overallPass = bagResults.length > 0 && bagResults.every(r => r.passedExpectedCount);
            const renderEnd = performance.now();

            setDetectionLog(`${allBoxes.length}개 알약 → ${clusters.length}봉지 (기대 ${expectedPerBag}알/봉, ${(inferEnd - startTime).toFixed(0)}ms)`);

            const metrics: PipelineMetrics = {
                captureMs: 0, warpMs: 0,
                inferMs: inferEnd - startTime,
                postprocessMs: renderEnd - inferEnd,
                renderMs: 1,
                totalMs: renderEnd - startTime
            };

            setResult({ results: bagResults, metrics, overallPass, expectedPerBag });
            setIsRunning(false);
        };

        if (img.complete && img.naturalWidth > 0) {
            handleLoad();
        } else {
            img.onload = handleLoad;
        }
    }, [isRunning, selectedSample]);

    if (result && selectedSample) {
        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 20 }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        테스트: <strong style={{ color: 'var(--text-primary)' }}>{selectedSample.name}</strong>
                        <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: 'var(--accent-blue)' }}>
                            (OpenCV 실제 감지)
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
                        imageUrl={selectedSample.imageUrl}
                        onRescan={() => { setResult(null); setSelectedSample(null); }}
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
                    OpenCV.js로 테스트 이미지에서 <strong>실제 알약을 감지</strong>합니다
                </p>
            </div>

            {isRunning && (
                <>
                    <img ref={imgRef} src={selectedSample?.imageUrl}
                        crossOrigin="anonymous"
                        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                        alt="detection source" />
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--accent-blue)' }}>
                        <div style={{ fontSize: '1.2rem', marginBottom: '8px' }}>🔍 감지 중...</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{detectionLog}</div>
                    </div>
                </>
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
