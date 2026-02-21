import React, { useState, useRef, useEffect } from 'react';

/**
 * Interface defining the exact corners needed to warp the mat.
 */
interface Point {
    x: number;
    y: number;
}

interface CalibrationGridProps {
    initialCanvas: HTMLCanvasElement | null;
    onWarpComplete: (warpedCanvas: HTMLCanvasElement) => void;
    onRetake: () => void;
}

export const CalibrationGrid: React.FC<CalibrationGridProps> = ({ initialCanvas, onWarpComplete, onRetake }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // 4 corners starting sequentially: Top-Left, Top-Right, Bottom-Right, Bottom-Left
    const [points, setPoints] = useState<Point[]>([]);
    const [errorMsg, setErrorMsg] = useState<string>('');

    // Render the still image onto the display canvas
    useEffect(() => {
        if (initialCanvas && canvasRef.current) {
            const parent = containerRef.current;
            const ctx = canvasRef.current.getContext('2d');
            if (ctx && parent) {
                // We scale the display canvas to fit the screen while keeping aspect ratio.
                // We must map taps back to the intrinsic resolution of the `initialCanvas` before warping.

                const aspect = initialCanvas.width / initialCanvas.height;
                const width = parent.clientWidth;
                const height = width / aspect;

                canvasRef.current.width = width;
                canvasRef.current.height = height;

                ctx.drawImage(initialCanvas, 0, 0, width, height);
            }
        }
    }, [initialCanvas]);

    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (points.length >= 4) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        // Calculate relative coordinates on the scaled display canvas
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setPoints(prev => {
            const newPoints = [...prev, { x, y }];
            return newPoints;
        });
    };

    const executeWarp = async () => {
        if (points.length !== 4 || !initialCanvas || !canvasRef.current) return;

        try {
            // 1. Calculate scaling factors
            const displayWidth = canvasRef.current.width;
            const displayHeight = canvasRef.current.height;
            const scaleX = initialCanvas.width / displayWidth;
            const scaleY = initialCanvas.height / displayHeight;

            // 2. Map the 4 tapped points back to the intrinsic resolution of the high-res capture
            const intrinsicPoints = points.map(p => ({
                x: p.x * scaleX,
                y: p.y * scaleY
            }));

            // 3. To avoid React hydration cycles messing with the OpenCV block, we import dynamically if needed
            // or rely on a global service instance.
            const CVService = (await import('../services/ComputerVision')).ComputerVision;

            const warpedCanvas = CVService.warpPerspective(initialCanvas, intrinsicPoints);

            if (warpedCanvas) {
                onWarpComplete(warpedCanvas);
            } else {
                setErrorMsg('Warp failed. Points might be invalid.');
            }
        } catch (e: any) {
            setErrorMsg(`Error during warp: ${e.message}`);
        }
    };

    const drawPointMarkers = () => {
        return points.map((p, index) => {
            const labels = ['TL', 'TR', 'BR', 'BL'];
            return (
                <div
                    key={index}
                    style={{
                        position: 'absolute',
                        left: `${p.x}px`,
                        top: `${p.y}px`,
                        width: '20px',
                        height: '20px',
                        backgroundColor: 'var(--accent-blue)',
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        pointerEvents: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        boxShadow: '0 0 10px rgba(0,0,0,0.5)',
                        border: '2px solid white'
                    }}
                >
                    {labels[index]}
                </div>
            );
        });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', position: 'relative' }} ref={containerRef}>
            <div style={{ padding: '20px', textAlign: 'center', background: 'rgba(0,0,0,0.8)', zIndex: 10 }}>
                <h3 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Manual Calibration</h3>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Tap the 4 corners of the mat sequentially:<br />
                    <strong style={{ color: 'var(--accent-blue)' }}>Top-Left → Top-Right → Bottom-Right → Bottom-Left</strong>
                </p>
                {errorMsg && <p style={{ color: 'var(--accent-red)', marginTop: '8px' }}>{errorMsg}</p>}
            </div>

            <div style={{ flex: 1, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#111' }}>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                    <canvas
                        ref={canvasRef}
                        onClick={handleCanvasClick}
                        style={{
                            display: 'block',
                            cursor: points.length < 4 ? 'crosshair' : 'default',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
                        }}
                    />
                    {drawPointMarkers()}
                </div>
            </div>

            <div style={{ padding: '20px', display: 'flex', gap: '16px', justifyContent: 'center', background: 'rgba(0,0,0,0.8)' }}>
                <button className="btn" style={{ background: 'var(--panel-bg)' }} onClick={onRetake}>
                    Retake Photo
                </button>
                <button
                    className="btn"
                    style={{ background: points.length < 4 ? 'var(--panel-bg)' : 'var(--accent-blue)' }}
                    disabled={points.length < 4}
                    onClick={executeWarp}
                >
                    {points.length < 4 ? `Tap ${4 - points.length} more` : 'Confirm & Scan'}
                </button>
            </div>
        </div>
    );
};
