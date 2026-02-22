import React, { useRef, useEffect, useCallback } from 'react';
import { BatchProcessingResult, BoundingBox } from '../services/Metrics';

interface ResultPanelProps {
    result: BatchProcessingResult;
    onRescan: () => void;
    expectedCount: number;
    imageUrl?: string;
}

/**
 * Draws bounding boxes on a canvas positioned over the image.
 * Auto-resizes to match the actual displayed image dimensions.
 */
const BBoxOverlay: React.FC<{
    boxes: BoundingBox[],
    containerRef: React.RefObject<HTMLDivElement | null>
}> = ({ boxes, containerRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const img = container.querySelector('img');
        if (!img) return;

        const rect = img.getBoundingClientRect();
        const contRect = container.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        canvas.style.left = `${rect.left - contRect.left}px`;
        canvas.style.top = `${rect.top - contRect.top}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        boxes.forEach(box => {
            const bx = (box.x - box.w / 2) * canvas.width;
            const by = (box.y - box.h / 2) * canvas.height;
            const bw = box.w * canvas.width;
            const bh = box.h * canvas.height;

            const color = box.confidence > 0.95 ? '#10b981' : box.confidence > 0.85 ? '#f59e0b' : '#ef4444';

            // Draw circle for pill
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(box.x * canvas.width, box.y * canvas.height, Math.max(bw, bh) / 2, 0, Math.PI * 2);
            ctx.stroke();

            // Small label
            ctx.font = 'bold 9px sans-serif';
            const labelText = `${(box.confidence * 100).toFixed(0)}%`;
            const tw = ctx.measureText(labelText).width + 4;
            ctx.fillStyle = color;
            ctx.fillRect(bx + bw, by - 10, tw, 12);
            ctx.fillStyle = '#fff';
            ctx.fillText(labelText, bx + bw + 2, by);
        });
    }, [boxes, containerRef]);

    useEffect(() => {
        draw();
        window.addEventListener('resize', draw);
        const t = setTimeout(draw, 300);
        return () => { window.removeEventListener('resize', draw); clearTimeout(t); };
    }, [draw]);

    return <canvas ref={canvasRef} style={{ position: 'absolute', pointerEvents: 'none' }} />;
};

/**
 * Full-screen result view:
 * - Photo fills entire area
 * - PASS/FAIL banner at top
 * - Per-bag counts as small labels along the bottom of the image
 * - Performance metrics as a small overlay in the corner
 * - Rescan button
 */
export const ResultPanel: React.FC<ResultPanelProps> = ({ result, onRescan, expectedCount, imageUrl }) => {
    const allPass = result.results.every(r => r.boxCount === expectedCount);
    const failBags = result.results.map((r, i) => ({ idx: i, count: r.boxCount, pass: r.boxCount === expectedCount }));
    const totalDetected = result.results.reduce((sum, r) => sum + r.boxCount, 0);
    const allBoxes = result.results.flatMap(r => r.boxes || []);
    const containerRef = useRef<HTMLDivElement>(null);

    const bgImage = imageUrl || '/testset/normal_5pills.png';

    return (
        <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>

            {/* Full-screen photo with bounding boxes */}
            <div ref={containerRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={bgImage} alt="검수 결과" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                <BBoxOverlay boxes={allBoxes} containerRef={containerRef} />
            </div>

            {/* Top: PASS/FAIL banner */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                background: allPass
                    ? 'linear-gradient(180deg, rgba(16,185,129,0.85) 0%, rgba(16,185,129,0) 100%)'
                    : 'linear-gradient(180deg, rgba(239,68,68,0.85) 0%, rgba(239,68,68,0) 100%)',
                padding: '12px 16px 24px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                zIndex: 10
            }}>
                <div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
                        {allPass ? '✅ 전량 정상' : '❌ 수량 이상 감지'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.9)', marginTop: '2px' }}>
                        총 {totalDetected}알 감지 · {result.results.length}봉지 검사
                    </div>
                </div>
                <button onClick={onRescan} style={{
                    background: 'rgba(255,255,255,0.25)', backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.4)', borderRadius: '8px',
                    color: '#fff', padding: '8px 16px', fontWeight: 600, fontSize: '0.85rem',
                    cursor: 'pointer', fontFamily: 'var(--font-base)'
                }}>
                    🔄 다음 배치
                </button>
            </div>

            {/* Bottom: Per-bag counts */}
            <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
                padding: '24px 8px 8px', zIndex: 10,
                display: 'flex', justifyContent: 'center', gap: '2px'
            }}>
                {failBags.map(bag => (
                    <div key={bag.idx} style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        padding: '3px 6px', borderRadius: '6px', minWidth: '36px',
                        background: bag.pass ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.3)',
                        border: `1px solid ${bag.pass ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.7)'}`
                    }}>
                        <span style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.6)' }}>{bag.idx + 1}</span>
                        <span style={{
                            fontSize: '0.9rem', fontWeight: 700,
                            color: bag.pass ? '#10b981' : '#ef4444'
                        }}>{bag.count}</span>
                    </div>
                ))}
            </div>

            {/* Bottom-right: Performance metrics */}
            <div style={{
                position: 'absolute', bottom: '50px', right: '8px',
                background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
                borderRadius: '8px', padding: '6px 10px', fontSize: '0.65rem',
                color: 'rgba(255,255,255,0.7)', zIndex: 11,
                display: 'flex', flexDirection: 'column', gap: '1px'
            }}>
                <span>촬영 {result.metrics.captureMs.toFixed(0)}ms</span>
                <span>추론 {result.metrics.inferMs.toFixed(0)}ms</span>
                <span style={{ fontWeight: 600, color: '#fff' }}>합계 {result.metrics.totalMs.toFixed(0)}ms</span>
            </div>
        </div>
    );
};
