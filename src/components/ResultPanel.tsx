import React, { useRef, useEffect, useState } from 'react';
import { BatchProcessingResult, BoundingBox } from '../services/Metrics';

interface ResultPanelProps {
    result: BatchProcessingResult;
    onRescan: () => void;
    expectedCount: number;
}

// Draw bounding boxes on a canvas overlay
const BBoxCanvas: React.FC<{ boxes: BoundingBox[], width: number, height: number, selectedBag: number | null }> = ({ boxes, width, height, selectedBag }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);

        boxes.forEach(box => {
            const bx = (box.x - box.w / 2) * width;
            const by = (box.y - box.h / 2) * height;
            const bw = box.w * width;
            const bh = box.h * height;

            // Color by confidence
            const color = box.confidence > 0.95 ? '#10b981' : box.confidence > 0.85 ? '#f59e0b' : '#ef4444';

            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.strokeRect(bx, by, bw, bh);

            // Confidence label
            ctx.fillStyle = color;
            ctx.fillRect(bx, by - 14, 36, 14);
            ctx.fillStyle = '#fff';
            ctx.font = '10px sans-serif';
            ctx.fillText(`${(box.confidence * 100).toFixed(0)}%`, bx + 2, by - 3);
        });
    }, [boxes, width, height, selectedBag]);

    return <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
};

export const ResultPanel: React.FC<ResultPanelProps> = ({ result, onRescan, expectedCount }) => {
    const allPass = result.results.every(r => r.boxCount === expectedCount);
    const failCount = result.results.filter(r => r.boxCount !== expectedCount).length;
    const [selectedBag, setSelectedBag] = useState<number | null>(null);

    // Gather all boxes or just selected bag's boxes
    const visibleBoxes: BoundingBox[] = selectedBag !== null
        ? (result.results[selectedBag]?.boxes || [])
        : result.results.flatMap(r => r.boxes || []);

    // Use test image as background (for demo)
    const bgImage = allPass ? '/testset/normal_5pills.png' : '/testset/fail_missing_pills.png';

    return (
        <div className="result-container">
            {/* Left: Annotated image with bounding boxes */}
            <div className="result-left">
                {/* Big result banner */}
                <div className="glass-panel" style={{
                    padding: '10px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderColor: allPass ? 'var(--accent-green)' : 'var(--accent-red)',
                    borderWidth: '2px',
                    flexShrink: 0
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1.5rem' }}>{allPass ? '✅' : '❌'}</span>
                        <div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: allPass ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                {allPass ? '전량 정상' : '수량 이상 감지'}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {allPass ? `${result.results.length}봉지 ${expectedCount}알 확인` : `${failCount}봉지 수량 불일치`}
                            </div>
                        </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 600, color: result.metrics.totalMs < 500 ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                            {result.metrics.totalMs.toFixed(0)}ms
                        </span>
                    </div>
                </div>

                {/* Annotated image with bounding boxes */}
                <div style={{ flex: 1, position: 'relative', borderRadius: '12px', overflow: 'hidden', background: '#111', minHeight: 0 }}>
                    <img src={bgImage} alt="검수 결과" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    <BBoxCanvas boxes={visibleBoxes} width={1024} height={512} selectedBag={selectedBag} />
                    <div style={{
                        position: 'absolute', bottom: '4px', left: '4px',
                        background: 'rgba(0,0,0,0.7)', padding: '3px 8px', borderRadius: '6px',
                        fontSize: '0.65rem', color: 'var(--text-secondary)'
                    }}>
                        {selectedBag !== null ? `${selectedBag + 1}번 봉지 ({visibleBoxes.length}알 감지)` : `전체 ${visibleBoxes.length}알 감지`}
                        {selectedBag !== null && (
                            <button onClick={() => setSelectedBag(null)}
                                style={{ marginLeft: '8px', background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '0.65rem' }}>
                                전체보기
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Right: Bag grid + Metrics + Actions */}
            <div className="result-right">
                {/* Bag grid — vertical for right panel */}
                <div className="glass-panel" style={{ padding: '8px', flex: 1, overflow: 'auto' }}>
                    <h4 style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '6px', textAlign: 'center' }}>봉지별 결과</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '3px' }}>
                        {result.results.map((r, i) => {
                            const isPass = r.boxCount === expectedCount;
                            const isSelected = selectedBag === i;
                            return (
                                <div key={i}
                                    onClick={() => setSelectedBag(isSelected ? null : i)}
                                    style={{
                                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                                        justifyContent: 'center', padding: '4px 2px', borderRadius: '6px',
                                        border: `2px solid ${isSelected ? 'var(--accent-blue)' : isPass ? 'var(--accent-green)' : 'var(--accent-red)'}`,
                                        background: isSelected ? 'rgba(59,130,246,0.15)' : isPass ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.1)',
                                        cursor: 'pointer', transition: 'all 0.15s ease'
                                    }}>
                                    <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>{i + 1}번</div>
                                    <div style={{ fontSize: '1rem', fontWeight: 700 }}>{r.boxCount}</div>
                                    <div style={{ fontSize: '0.55rem', color: isPass ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                                        {isPass ? '정상' : '이상'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Performance */}
                <div className="glass-panel" style={{ padding: '8px' }}>
                    <h4 style={{ color: 'var(--text-secondary)', marginBottom: '4px', fontSize: '0.7rem' }}>⏱ 처리성능</h4>
                    <div style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>촬영</span><span>{result.metrics.captureMs.toFixed(0)}ms</span></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>추론</span><span>{result.metrics.inferMs.toFixed(0)}ms</span></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}><span>합계</span><span>{result.metrics.totalMs.toFixed(0)}ms</span></div>
                    </div>
                </div>

                <button className="btn" style={{ width: '100%', fontSize: '0.85rem', fontWeight: 600 }} onClick={onRescan}>
                    🔄 다음 배치
                </button>
            </div>
        </div>
    );
};
