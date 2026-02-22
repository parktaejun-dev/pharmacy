import React, { useState, useRef, useEffect } from 'react';
import { PillDetector } from '../services/PillDetector';
import { BatchProcessingResult, PipelineMetrics, InferenceResult, BoundingBox } from '../services/Metrics';
import { ResultPanel } from '../components/ResultPanel';

interface TestSample {
    id: string;
    name: string;
    imageUrl: string;
    expectedPerBag: number;
    bagCount: number;
    description: string;
    label: '정상' | '이상';
}

const TEST_SAMPLES: TestSample[] = [
    {
        id: 'normal_5',
        name: '정상 세트 (5알×10봉지)',
        imageUrl: '/testset/normal_5pills.png',
        expectedPerBag: 5,
        bagCount: 10,
        description: '10봉지 모두 5알씩 정상 포장',
        label: '정상'
    },
    {
        id: 'fail_missing',
        name: '이상 세트 (알약 부족)',
        imageUrl: '/testset/fail_missing_pills.png',
        expectedPerBag: 5,
        bagCount: 10,
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

    // Run detection once image is loaded
    useEffect(() => {
        if (!isRunning || !selectedSample || !imgRef.current) return;

        const img = imgRef.current;
        const handleLoad = () => {
            setDetectionLog('OpenCV 감지 실행 중...');

            const startTime = performance.now();

            // Run real OpenCV detection
            const allBoxes = PillDetector.detectFromImage(img);
            const inferEnd = performance.now();

            setDetectionLog(`${allBoxes.length}개 알약 감지 완료 (${(inferEnd - startTime).toFixed(0)}ms)`);

            // Assign boxes to bags based on x position
            const bagResults = assignBoxesToBags(allBoxes, selectedSample.bagCount, selectedSample.expectedPerBag);

            const overallPass = bagResults.every(r => r.boxCount === selectedSample.expectedPerBag);
            const renderEnd = performance.now();

            const metrics: PipelineMetrics = {
                captureMs: 0,
                warpMs: 0,
                inferMs: inferEnd - startTime,
                postprocessMs: renderEnd - inferEnd,
                renderMs: 1,
                totalMs: renderEnd - startTime
            };

            setResult({ results: bagResults, metrics, overallPass });
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
                <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                <div style={{ flex: 1, display: 'flex' }}>
                    <ResultPanel result={result} expectedCount={selectedSample.expectedPerBag}
                        onRescan={() => { setResult(null); setSelectedSample(null); }} />
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
                    {/* Hidden image for detection */}
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

/**
 * Assign detected bounding boxes to bag regions.
 * Divides the image into N equal vertical strips and assigns each box to the nearest bag.
 */
function assignBoxesToBags(boxes: BoundingBox[], bagCount: number, expectedPerBag: number): InferenceResult[] {
    const bagWidth = 1.0 / bagCount;

    const bags: BoundingBox[][] = Array(bagCount).fill(null).map(() => []);

    for (const box of boxes) {
        const bagIdx = Math.min(bagCount - 1, Math.max(0, Math.floor(box.x / bagWidth)));
        bags[bagIdx].push(box);
    }

    return bags.map(bagBoxes => ({
        boxCount: bagBoxes.length,
        confidenceAverage: bagBoxes.length > 0
            ? bagBoxes.reduce((sum, b) => sum + b.confidence, 0) / bagBoxes.length
            : 0,
        passedExpectedCount: bagBoxes.length === expectedPerBag,
        boxes: bagBoxes
    }));
}
