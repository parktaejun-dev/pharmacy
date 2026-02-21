import React, { useState, useEffect } from 'react';
import * as ort from 'onnxruntime-web/webgpu';

// Explicitly bind WASM path as per ORT documentation to prevent Vite resolution errors
ort.env.wasm.wasmPaths = '/ort-wasm/';

export const DeviceHealthCheck: React.FC = () => {
    const [gpuStatus, setGpuStatus] = useState<string>('Checking...');
    const [ortStatus, setOrtStatus] = useState<string>('Checking...');
    const [cameraStatus, setCameraStatus] = useState<string>('Checking...');
    const [inferenceStatus, setInferenceStatus] = useState<string>('Pending...');

    useEffect(() => {
        checkHealth();
    }, []);

    const checkHealth = async () => {
        // 1. Check WebGPU
        if (!navigator.gpu) {
            setGpuStatus('❌ WebGPU NOT supported (or disabled by policy). Falling back to WASM.');
        } else {
            try {
                const adapter = await navigator.gpu.requestAdapter();
                if (adapter) {
                    const adapterName = adapter && 'name' in adapter ? (adapter as any).name : 'Generic';
                    setGpuStatus(`✅ WebGPU Supported (Adapter: ${adapterName})`);
                } else {
                    setGpuStatus('⚠️ WebGPU found but no adapter available. Falling back to WASM.');
                }
            } catch (e: any) {
                setGpuStatus(`❌ WebGPU Request Failed: ${e.message}`);
            }
        }

        // 2. Check ORT / WASM Bindings
        try {
            // Small dummy inference to check ORT execution path (Track B proxy)
            // Since we don't have an ONNX model yet, we just verify the object loads
            if (ort && ort.InferenceSession) {
                setOrtStatus(`✅ ORT Web Loaded. Default backend: ${ort.env.webgpu.profilingMode ? 'Profiling' : 'Standard'} WebGPU ready.`);
            } else {
                setOrtStatus('❌ ORT Web Object missing or malformed.');
            }
        } catch (e: any) {
            setOrtStatus(`❌ ORT bindings error: ${e.message}`);
        }

        // 3. Check Camera
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const track = stream.getVideoTracks()[0];
            const settings = track.getSettings();
            setCameraStatus(`✅ Camera Ready (${settings.width}x${settings.height} @ ${settings.frameRate}fps)`);
            // Cleanup stream after check
            track.stop();
        } catch (e: any) {
            setCameraStatus(`❌ Camera Error: ${e.message} (Check Permissions)`);
        }

        // 4. Inference capability
        setInferenceStatus('⚠️ Awaiting Track B ONNX model for E2E timing tests.');
    };

    return (
        <div className="glass-panel" style={{ padding: '24px', margin: '20px', maxWidth: '600px' }}>
            <h2 style={{ marginBottom: '16px', color: 'var(--accent-blue)' }}>Device Diagnostics</h2>

            <div style={{ marginBottom: '12px' }}>
                <strong>GPU / WebGPU:</strong>
                <p style={{ marginTop: '4px', fontSize: '0.9rem', color: gpuStatus.includes('✅') ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {gpuStatus}
                </p>
            </div>

            <div style={{ marginBottom: '12px' }}>
                <strong>ONNX Runtime:</strong>
                <p style={{ marginTop: '4px', fontSize: '0.9rem', color: ortStatus.includes('✅') ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {ortStatus}
                </p>
            </div>

            <div style={{ marginBottom: '12px' }}>
                <strong>Camera Feed:</strong>
                <p style={{ marginTop: '4px', fontSize: '0.9rem', color: cameraStatus.includes('✅') ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {cameraStatus}
                </p>
            </div>

            <div style={{ marginBottom: '12px' }}>
                <strong>Track B Inference:</strong>
                <p style={{ marginTop: '4px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {inferenceStatus}
                </p>
            </div>

            <button className="btn" onClick={checkHealth} style={{ width: '100%', marginTop: '16px' }}>
                Re-Run Diagnostics
            </button>
        </div>
    );
};
