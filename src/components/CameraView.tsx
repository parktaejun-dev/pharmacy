import React, { useRef, useEffect, useState, useCallback } from 'react';

interface CameraViewProps {
    onFrameReady: (canvas: HTMLCanvasElement) => void;
    isActive: boolean;
    onQualityUpdate: (metrics: QualityMetrics) => void;
}

export interface QualityMetrics {
    isStable: boolean;
    glareScore: number;
    blurScore: number;
    rejectionReason?: string;
}

export const CameraView: React.FC<CameraViewProps> = ({ onFrameReady, isActive, onQualityUpdate: _onQualityUpdate }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [hasPermission, setHasPermission] = useState<boolean>(true);
    const animationFrameId = useRef<number>();

    // Start Camera
    const startCamera = useCallback(async () => {
        try {
            // Android Chrome 121+ optimal settings for scanning
            const constraints = {
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    frameRate: { ideal: 30 }
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
            }
            setHasPermission(true);
        } catch (err) {
            console.error("Camera access denied or unavailable", err);
            setHasPermission(false);
        }
    }, []);

    // Stop Camera
    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }, []);

    // Frame processing loop
    const processFrame = useCallback(() => {
        if (!isActive || !videoRef.current || !canvasRef.current) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            // Setup canvas dimensions to match video stream layout
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
            }

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                // Draw frame to internal canvas
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Let the parent / QualityGate logic analyze the frame using OpenCV
                onFrameReady(canvas);
            }
        }

        // Loop
        animationFrameId.current = requestAnimationFrame(processFrame);
    }, [isActive, onFrameReady]);

    // Lifecycle
    useEffect(() => {
        if (isActive) {
            startCamera().then(() => {
                animationFrameId.current = requestAnimationFrame(processFrame);
            });
        } else {
            stopCamera();
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        }

        return () => {
            stopCamera();
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        };
    }, [isActive, startCamera, stopCamera, processFrame]);

    if (!hasPermission) {
        return (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--accent-red)' }}>
                <p>Camera permission denied or device not found.</p>
                <p>Please allow camera access in browser settings to continue.</p>
            </div>
        );
    }

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#000' }}>
            <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                }}
            />
            {/* Hidden canvas for image data extraction */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* UI Overlay for alignment guides */}
            <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '80%',
                height: '30%',
                border: '2px dashed rgba(255,255,255,0.4)',
                borderRadius: '8px',
                pointerEvents: 'none'
            }}>
                <div style={{ position: 'absolute', top: '-24px', width: '100%', textAlign: 'center', color: 'rgba(255,255,255,0.8)', fontSize: '0.8rem' }}>
                    Align the 10-cell mat inside this box
                </div>
            </div>
        </div>
    );
};
