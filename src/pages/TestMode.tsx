import React, { useState } from 'react';
import { MvpInferenceService } from '../services/Inference';
import { BatchProcessingResult, PipelineMetrics } from '../services/Metrics';
import { ResultPanel } from '../components/ResultPanel';

interface TestSample {
    id: string;
    name: string;
    imageUrl: string;
    expectedPerBag: number;
    description: string;
    label: '정상' | '이상';
}

const TEST_SAMPLES: TestSample[] = [
    {
        id: 'normal_5',
        name: '정상 세트 (5알×10봉지)',
        imageUrl: '/testset/normal_5pills.png',
        expectedPerBag: 5,
        description: '10봉지 모두 5알씩 정상 포장',
        label: '정상'
    },
    {
        id: 'fail_missing',
        name: '이상 세트 (8번 봉지 부족)',
        imageUrl: '/testset/fail_missing_pills.png',
        expectedPerBag: 5,
        description: '8번 봉지에 알약 부족 — 이상 감지 테스트',
        label: '이상'
    }
];

export const TestMode: React.FC = () => {
    const [selectedSample, setSelectedSample] = useState<TestSample | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState<BatchProcessingResult | null>(null);

    const runTest = async (sample: TestSample) => {
        setSelectedSample(sample);
        setIsRunning(true);
        setResult(null);

        const startTime = performance.now();

        // Simulate different results based on test case
        let inferenceResult: BatchProcessingResult;
        if (sample.label === '정상') {
            inferenceResult = await MvpInferenceService.runTrackAStub(sample.expectedPerBag);
        } else {
            // Simulate a failure case — modify one bag's count
            inferenceResult = await MvpInferenceService.runTrackAStub(sample.expectedPerBag);
            // Manually inject the anomaly
            if (inferenceResult.results.length > 7) {
                inferenceResult.results[7] = {
                    ...inferenceResult.results[7],
                    boxCount: sample.expectedPerBag - 2
                };
            }
        }

        const endTime = performance.now();
        const finalMetrics: PipelineMetrics = {
            ...inferenceResult.metrics,
            captureMs: 0,
            warpMs: 0,
            totalMs: endTime - startTime
        };

        setResult({ ...inferenceResult, metrics: finalMetrics });
        setIsRunning(false);
    };

    if (result && selectedSample) {
        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        테스트: <strong style={{ color: 'var(--text-primary)' }}>{selectedSample.name}</strong>
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
                    합성 테스트 이미지로 검수 파이프라인을 테스트합니다
                </p>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {TEST_SAMPLES.map(sample => (
                    <div key={sample.id} className="glass-panel" style={{
                        width: 'calc(50% - 6px)',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        border: `1px solid ${sample.label === '정상' ? 'var(--accent-green)' : 'var(--accent-red)'}`
                    }}
                        onClick={() => !isRunning && runTest(sample)}
                    >
                        <img src={sample.imageUrl} alt={sample.name}
                            style={{ width: '100%', height: '120px', objectFit: 'cover' }} />
                        <div style={{ padding: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{sample.name}</span>
                                <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
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

                {isRunning && (
                    <div style={{ width: '100%', textAlign: 'center', padding: '20px', color: 'var(--accent-blue)' }}>
                        분석 중...
                    </div>
                )}
            </div>
        </div>
    );
};
