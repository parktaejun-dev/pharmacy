import * as ort from 'onnxruntime-web/webgpu';
import { BatchProcessingResult, PipelineMetrics } from './Metrics';

// Mandated configuration constraint
ort.env.wasm.wasmPaths = '/ort-wasm/';

export class InferenceService {
    private session: ort.InferenceSession | null = null;


    /**
     * Initializes the ORT Session with a dummy ONNX model for Track B.
     * Prioritizes WebGPU but gracefully falls back to WASM for unsupported Android configurations.
     */
    async initializeSession(modelUrl: string): Promise<boolean> {
        try {
            // Phase 0 Device constraint: Attempt WebGPU first
            if (navigator.gpu) {
                try {
                    this.session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['webgpu'] });
                    console.log("✅ Track B: ORT Session created with WebGPU backend.");
                    return true;
                } catch (webgpuError) {
                    console.warn("⚠️ WebGPU session creation failed, falling back to WASM", webgpuError);
                }
            }

            // Fallback
            this.session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
            console.log("✅ Track B: ORT Session created with WASM backend.");
            return true;

        } catch (e) {
            console.error("❌ Failed to initialize Track B ORT session", e);
            return false;
        }
    }

    /**
     * TRACK A: Pure Stub Inference
     * Used to quickly test the E2E state machine, UI, and SLA timing metrics
     * without requiring an active ONNX model.
     */
    async runTrackAStub(expectedUniformCount: number): Promise<BatchProcessingResult> {
        const startTime = performance.now();

        // Simulate some work taking roughly 150-250ms (average cheap WASM ONNX time)
        await new Promise(resolve => setTimeout(resolve, 200));

        const inferEnd = performance.now();

        // Stub: 10 valid bags of expected count
        const results = Array(10).fill(0).map(() => ({
            boxCount: expectedUniformCount,
            confidenceAverage: 0.98,
            passedExpectedCount: true
        }));

        // If uniform rule is enabled, assume all pass for Track A true
        const overallPass = results.every(r => r.passedExpectedCount);

        const renderEnd = performance.now();

        const metrics: PipelineMetrics = {
            captureMs: 0, // Injected by caller
            warpMs: 0,    // Injected by caller
            inferMs: inferEnd - startTime,
            postprocessMs: 2,
            renderMs: renderEnd - inferEnd,
            totalMs: 0    // Handled by caller
        };

        return { results, metrics, overallPass };
    }

    /**
     * TRACK B: Real dummy ONNX execution.
     * Demonstrates capability to process tensor data and output shapes to verify ORT WebGPU/WASM routing.
     * Does NOT interpret the output as accurate pill counts for Phase 0.
     */
    async runTrackBDummy(tensor: ort.Tensor): Promise<{ inferMs: number, shape: string }> {
        if (!this.session) throw new Error("Session not initialized for Track B");

        const startTime = performance.now();

        // Run inference (dummy model expects an input named 'images' typically, e.g. YOLO format)
        // We try to grab the first input name from the session metadata
        const inputName = this.session.inputNames[0];
        const feeds: Record<string, ort.Tensor> = {};
        feeds[inputName] = tensor;

        const results = await this.session.run(feeds);

        const endTime = performance.now();

        const outputName = this.session.outputNames[0];
        const outputTensor = results[outputName];

        console.log(`✅ Track B: Dummy Inference completed. Output shape: ${outputTensor.dims.join('x')}`);

        return {
            inferMs: endTime - startTime,
            shape: outputTensor.dims.join('x')
        };
    }
}

// Singleton for app-wide use
export const MvpInferenceService = new InferenceService();
