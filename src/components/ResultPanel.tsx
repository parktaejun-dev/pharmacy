import React from 'react';
import { BatchProcessingResult } from '../services/Metrics';

interface ResultPanelProps {
    result: BatchProcessingResult;
    onRescan: () => void;
    expectedCount: number;
}

export const ResultPanel: React.FC<ResultPanelProps> = ({ result, onRescan, expectedCount }) => {
    const allPass = result.results.every(r => r.boxCount === expectedCount);
    const failCount = result.results.filter(r => r.boxCount !== expectedCount).length;

    return (
        <div className="result-container">
            {/* Left side: Overall result + Bag grid */}
            <div className="result-left">
                {/* Big result banner */}
                <div
                    className="glass-panel"
                    style={{
                        padding: '12px 20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderColor: allPass ? 'var(--accent-green)' : 'var(--accent-red)',
                        borderWidth: '2px'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '2rem' }}>{allPass ? '✅' : '❌'}</span>
                        <div>
                            <div style={{
                                fontSize: '1.4rem',
                                fontWeight: 700,
                                color: allPass ? 'var(--accent-green)' : 'var(--accent-red)'
                            }}>
                                {allPass ? '전량 정상' : '수량 이상 감지'}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                {allPass
                                    ? `${result.results.length}봉지 모두 ${expectedCount}알 확인`
                                    : `${failCount}봉지에서 수량 불일치`
                                }
                            </div>
                        </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        처리시간<br />
                        <span style={{ fontSize: '1.1rem', fontWeight: 600, color: result.metrics.totalMs < 500 ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                            {result.metrics.totalMs.toFixed(0)}ms
                        </span>
                    </div>
                </div>

                {/* Bag grid — horizontal 10 columns for landscape */}
                <div className="bag-grid">
                    {result.results.map((r, i) => {
                        const isPass = r.boxCount === expectedCount;
                        return (
                            <div key={i} className={`bag-cell ${isPass ? 'pass' : 'fail'}`}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                                    {i + 1}번
                                </div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                                    {r.boxCount}
                                </div>
                                <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>
                                    /{expectedCount}알
                                </div>
                                <div style={{
                                    marginTop: '2px',
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    color: isPass ? 'var(--accent-green)' : 'var(--accent-red)'
                                }}>
                                    {isPass ? '정상' : '이상'}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Right side: Metrics + Actions */}
            <div className="result-right">
                <div className="glass-panel" style={{ padding: '12px', flex: 1 }}>
                    <h4 style={{ color: 'var(--text-secondary)', marginBottom: '8px', fontSize: '0.8rem' }}>
                        ⏱ 처리 성능 (ms)
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>촬영</span><span>{result.metrics.captureMs.toFixed(1)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>보정</span><span>{result.metrics.warpMs.toFixed(1)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>추론 (AI)</span><span>{result.metrics.inferMs.toFixed(1)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>후처리</span><span>{(result.metrics.postprocessMs + result.metrics.renderMs).toFixed(1)}</span>
                        </div>
                        <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '4px 0' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                            <span>총 소요시간</span>
                            <span style={{ color: result.metrics.totalMs < 500 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                {result.metrics.totalMs.toFixed(0)}ms
                            </span>
                        </div>
                    </div>
                </div>

                <button className="btn" style={{ width: '100%', fontSize: '0.9rem', fontWeight: 600 }} onClick={onRescan}>
                    🔄 다음 배치 검수
                </button>
            </div>
        </div>
    );
};
