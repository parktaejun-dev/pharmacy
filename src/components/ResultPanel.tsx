import React from 'react';
import { BatchProcessingResult } from '../services/Metrics';

interface ResultPanelProps {
    result: BatchProcessingResult;
    onRescan: () => void;
    expectedCount: number;
}

export const ResultPanel: React.FC<ResultPanelProps> = ({ result, onRescan, expectedCount }) => {
    const allPass = result.results.every(r => r.boxCount === expectedCount);

    return (
        <div className="glass-panel" style={{ padding: '24px', margin: '20px', width: '90%', maxWidth: '600px', textAlign: 'center' }}>
            <h2 style={{ color: allPass ? 'var(--accent-green)' : 'var(--accent-red)', marginBottom: '16px', fontSize: '2rem' }}>
                {allPass ? 'PASS' : 'FAIL'}
            </h2>

            {!allPass && (
                <p style={{ color: 'var(--accent-red)', marginBottom: '20px', fontWeight: 'bold' }}>
                    Mismatched Pill Count Detected
                </p>
            )}

            {/* Grid rendering for the 10 Packets */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '24px' }}>
                {result.results.map((r, i) => (
                    <div
                        key={i}
                        style={{
                            padding: '12px 4px',
                            borderRadius: '8px',
                            border: `2px solid ${r.boxCount === expectedCount ? 'var(--accent-green)' : 'var(--accent-red)'}`,
                            background: 'rgba(255,255,255,0.05)'
                        }}
                    >
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Bag {i + 1}</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{r.boxCount}</div>
                    </div>
                ))}
            </div>

            <div style={{ background: 'rgba(0,0,0,0.5)', padding: '16px', borderRadius: '8px', textAlign: 'left', marginBottom: '24px' }}>
                <h4 style={{ color: 'var(--text-secondary)', marginBottom: '8px', fontSize: '0.9rem' }}>E2E SLA Performance (ms)</h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span>Capture:</span> <span>{result.metrics.captureMs.toFixed(1)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span>Warp (CV):</span> <span>{result.metrics.warpMs.toFixed(1)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span>Infer (ORT):</span> <span>{result.metrics.inferMs.toFixed(1)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span>Post/Render:</span> <span>{(result.metrics.postprocessMs + result.metrics.renderMs).toFixed(1)}</span>
                </div>
                <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '8px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                    <span>Total E2E:</span>
                    <span style={{ color: result.metrics.totalMs < 500 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {result.metrics.totalMs.toFixed(1)} ms
                    </span>
                </div>
            </div>

            <button className="btn" style={{ width: '100%' }} onClick={onRescan}>
                Scan Next Batch
            </button>
        </div>
    );
};
