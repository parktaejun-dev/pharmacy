import React, { useRef, useEffect, useCallback } from 'react';
import { BatchProcessingResult, BoundingBox, InferenceResult } from '../services/Metrics';

interface ResultPanelProps {
    result: BatchProcessingResult;
    onRescan: () => void;
    expectedCount: number;
    imageUrl?: string;
}

const BBoxOverlay: React.FC<{
    boxes: BoundingBox[],
    bagResults: InferenceResult[],
    expectedCount: number,
    containerRef: React.RefObject<HTMLDivElement | null>
}> = ({ boxes, bagResults, expectedCount, containerRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const img = container.querySelector('img');
        if (!img) return;

        const rect = img.getBoundingClientRect();
        const contRect = container.getBoundingClientRect();

        let renderWidth = rect.width;
        let renderHeight = rect.height;

        if (img.naturalWidth && img.naturalHeight) {
            const imgRatio = img.naturalWidth / img.naturalHeight;
            const contRatio = rect.width / rect.height;

            if (imgRatio > contRatio) {
                // Image is wider than container, so it's letterboxed (padding on top/bottom)
                renderHeight = rect.width / imgRatio;
            } else {
                // Image is taller, so it's pillarboxed (padding on left/right)
                renderWidth = rect.height * imgRatio;
            }
        }

        const offsetX = (rect.width - renderWidth) / 2;
        const offsetY = (rect.height - renderHeight) / 2;

        canvas.width = renderWidth;
        canvas.height = renderHeight;
        canvas.style.left = `${rect.left - contRect.left + offsetX}px`;
        canvas.style.top = `${rect.top - contRect.top + offsetY}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Green boxes on all detected pills
        boxes.forEach(box => {
            const bx = (box.x - box.w / 2) * canvas.width;
            const by = (box.y - box.h / 2) * canvas.height;
            const bw = box.w * canvas.width;
            const bh = box.h * canvas.height;
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2;
            ctx.strokeRect(bx, by, bw, bh);
            ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
            ctx.fillRect(bx, by, bw, bh);
        });

        // Per-bag count labels at cluster centroids
        bagResults.forEach((bag, i) => {
            if (bag.boxes.length === 0) return;
            const isPass = bag.boxCount === expectedCount;
            const xs = bag.boxes.map(b => b.x);
            const ys = bag.boxes.map(b => b.y);
            const minX = Math.min(...xs) - 0.01;
            const maxX = Math.max(...xs) + 0.01;
            const maxY = Math.max(...ys);
            const cx = ((minX + maxX) / 2) * canvas.width;
            const labelY = (maxY + 0.04) * canvas.height;

            const countText = `${bag.boxCount}`;
            ctx.font = 'bold 14px sans-serif';
            const tw = ctx.measureText(countText).width;
            const pillW = Math.max(tw + 12, 24);
            const pillH = 20;

            ctx.fillStyle = isPass ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)';
            ctx.beginPath();
            ctx.roundRect(cx - pillW / 2, labelY - pillH / 2, pillW, pillH, 4);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(countText, cx, labelY);

            ctx.font = '9px sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillText(`${i + 1}번`, cx, labelY - pillH / 2 - 8);

            if (!isPass) {
                const rx = minX * canvas.width;
                const ry = Math.min(...ys.map(y => y - 0.02)) * canvas.height;
                const rw = (maxX - minX) * canvas.width;
                const rh = (maxY - Math.min(...ys) + 0.04) * canvas.height;
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(rx, ry, rw, rh);
                ctx.setLineDash([]);
            }
        });
    }, [boxes, bagResults, expectedCount, containerRef]);

    useEffect(() => {
        draw();
        window.addEventListener('resize', draw);
        const t = setTimeout(draw, 300);
        return () => { window.removeEventListener('resize', draw); clearTimeout(t); };
    }, [draw]);

    return <canvas ref={canvasRef} style={{ position: 'absolute', pointerEvents: 'none' }} />;
};

export const ResultPanel: React.FC<ResultPanelProps> = ({ result, onRescan, expectedCount, imageUrl }) => {
    const allPass = result.results.every(r => r.boxCount === expectedCount);
    const totalDetected = result.results.reduce((sum, r) => sum + r.boxCount, 0);
    const failCount = result.results.filter(r => !r.passedExpectedCount).length;
    const allBoxes = result.results.flatMap(r => r.boxes || []);
    const containerRef = useRef<HTMLDivElement>(null);
    const bgImage = imageUrl || '/testset/normal_5pills.png';

    return (
        <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>
            {/* Full-screen photo */}
            <div ref={containerRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={bgImage} alt="검수 결과" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                <BBoxOverlay boxes={allBoxes} bagResults={result.results} expectedCount={expectedCount} containerRef={containerRef} />
            </div>

            {/* Top banner */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                background: allPass
                    ? 'linear-gradient(180deg, rgba(16,185,129,0.85) 0%, rgba(16,185,129,0) 100%)'
                    : 'linear-gradient(180deg, rgba(239,68,68,0.85) 0%, rgba(239,68,68,0) 100%)',
                padding: '10px 16px 20px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                zIndex: 10
            }}>
                <div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
                        {allPass ? '✅ 전량 정상' : '❌ 수량 이상 감지'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', marginTop: '2px' }}>
                        총 {totalDetected}알 · {result.results.length}봉지 · 기대 {expectedCount}알/봉
                        {failCount > 0 && ` · ${failCount}봉지 이상`}
                    </div>
                </div>
                <button onClick={onRescan} style={{
                    background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px',
                    color: '#fff', padding: '8px 14px', fontWeight: 600, fontSize: '0.8rem',
                    cursor: 'pointer', fontFamily: 'var(--font-base)'
                }}>
                    🔄 다음 배치
                </button>
            </div>

            {/* Performance */}
            <div style={{
                position: 'absolute', top: '8px', right: '140px',
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                borderRadius: '6px', padding: '4px 8px', fontSize: '0.6rem',
                color: 'rgba(255,255,255,0.7)', zIndex: 11
            }}>
                촬영 {result.metrics.captureMs.toFixed(0)}ms · 추론 {result.metrics.inferMs.toFixed(0)}ms · 합계 <b style={{ color: '#fff' }}>{result.metrics.totalMs.toFixed(0)}ms</b>
                {result.metrics.debugStr && (
                    <div style={{ marginTop: '2px', color: 'var(--accent-blue)', fontSize: '0.55rem' }}>{result.metrics.debugStr}</div>
                )}
            </div>
        </div>
    );
};
