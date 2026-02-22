import * as ort from 'onnxruntime-web';
import { BatchProcessingResult, BoundingBox, PipelineMetrics } from './Metrics';
import { PillDetector } from './PillDetector';

ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
ort.env.wasm.simd = true;
// Force absolute URL to ensure worker resolves it against the domain root, regardless of Vite's asset bundling
ort.env.wasm.wasmPaths = window.location.origin + '/ort-wasm/';

export class InferenceService {
    private session: ort.InferenceSession | null = null;
    private dummySession: ort.InferenceSession | null = null;
    private isInitialized = false;

    async init() {
        if (this.isInitialized) return;

        try {
            // First, attempt to load a user-provided roboflow.onnx
            const response = await fetch('/models/roboflow.onnx', { method: 'HEAD' });
            if (response.ok) {
                console.log("Loading custom Roboflow model: /models/roboflow.onnx");
                this.session = await ort.InferenceSession.create('/models/roboflow.onnx', { executionProviders: ['wasm'] });
            } else {
                throw new Error("roboflow.onnx not found");
            }
        } catch (e) {
            console.log("Falling back to default model: /models/best.onnx");
            this.session = await ort.InferenceSession.create('/models/best.onnx', { executionProviders: ['wasm'] });
        }

        try {
            this.dummySession = await ort.InferenceSession.create('/models/dummy.onnx', { executionProviders: ['wasm'] });
        } catch (e) {
            console.warn("Dummy session not loaded. Inference Track B will fail if called.");
        }

        this.isInitialized = true;
        console.log("✅ Models loaded.");
    }

    private preprocess(canvas: HTMLCanvasElement): { tensor: ort.Tensor, scale: number, padX: number, padY: number } {
        PillDetector.applyCLAHE(canvas);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 640;
        tempCanvas.height = 640;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (!tempCtx) throw new Error("Could not get temp canvas context");

        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, 640, 640);

        const scale = Math.min(640 / canvas.width, 640 / canvas.height);
        const scaledW = canvas.width * scale;
        const scaledH = canvas.height * scale;
        const padX = (640 - scaledW) / 2;
        const padY = (640 - scaledH) / 2;

        tempCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, padX, padY, scaledW, scaledH);

        const imgData = tempCtx.getImageData(0, 0, 640, 640);
        const data = imgData.data;

        const float32Data = new Float32Array(3 * 640 * 640);
        let offset = 0;
        const c1 = 640 * 640;
        const c2 = 2 * 640 * 640;

        for (let i = 0; i < data.length; i += 4) {
            float32Data[offset] = data[i] / 255.0;           // R
            float32Data[c1 + offset] = data[i + 1] / 255.0;  // G
            float32Data[c2 + offset] = data[i + 2] / 255.0;  // B
            offset++;
        }

        return {
            tensor: new ort.Tensor('float32', float32Data, [1, 3, 640, 640]),
            scale, padX, padY
        };
    }

    private postprocess(outputTensor: ort.Tensor, padX: number, padY: number, confThreshold: number = 0.08): { boxes: BoundingBox[], maxConf: number } {
        const data = outputTensor.data as Float32Array;
        const dims = outputTensor.dims;
        let numPriors = 8400;
        let featureDim = 6;
        let isTranspose = false;
        let batchOffset = 0;

        if (dims.length === 3) {
            // YOLOv8 typical shapes: [batch, 4 + classes, 8400] or [batch, 8400, 4 + classes]
            if (dims[1] < dims[2]) {
                // shape [batch, features, priors]
                featureDim = dims[1];
                numPriors = dims[2];
                isTranspose = true;
            } else {
                // shape [batch, priors, features]
                numPriors = dims[1];
                featureDim = dims[2];
                isTranspose = false;
            }
        } else if (dims.length === 2) {
            numPriors = dims[0];
            featureDim = dims[1];
            isTranspose = false;
        } else {
            console.warn("Unexpected output tensor shape:", dims);
            return { boxes: [], maxConf: 0 };
        }

        const numClasses = featureDim - 4;
        if (numClasses <= 0) {
            console.error("Invalid feature dimensions for YOLOv8.");
            return { boxes: [], maxConf: 0 };
        }

        let boxes: BoundingBox[] = [];
        let maxConf = 0;

        const scaledW = 640 - 2 * padX;
        const scaledH = 640 - 2 * padY;

        for (let i = 0; i < numPriors; i++) {
            let priorMaxConf = 0;
            let bestClassId = 0;

            for (let c = 0; c < numClasses; c++) {
                const confIdx = isTranspose
                    ? batchOffset + (4 + c) * numPriors + i
                    : batchOffset + i * featureDim + (4 + c);

                const cConf = data[confIdx];
                if (cConf > priorMaxConf) {
                    priorMaxConf = cConf;
                    bestClassId = c;
                }
            }

            if (priorMaxConf > maxConf) maxConf = priorMaxConf;

            if (priorMaxConf > confThreshold) {
                // Parse Center X, Center Y, Width, Height using dynamic index mapping
                const cx640 = isTranspose ? data[batchOffset + 0 * numPriors + i] : data[batchOffset + i * featureDim + 0];
                const cy640 = isTranspose ? data[batchOffset + 1 * numPriors + i] : data[batchOffset + i * featureDim + 1];
                const w640 = isTranspose ? data[batchOffset + 2 * numPriors + i] : data[batchOffset + i * featureDim + 2];
                const h640 = isTranspose ? data[batchOffset + 3 * numPriors + i] : data[batchOffset + i * featureDim + 3];

                const normX = (cx640 - padX) / scaledW;
                const normY = (cy640 - padY) / scaledH;
                const rawNormW = w640 / scaledW;
                const rawNormH = h640 / scaledH;

                // Shrink boxes by a factor to counteract model padding, improving NMS grouping
                const normW = rawNormW * 0.55;
                const normH = rawNormH * 0.55;

                boxes.push({
                    x: normX,
                    y: normY,
                    w: normW,
                    h: normH,
                    confidence: priorMaxConf,
                    label: `pill_${bestClassId}`
                });
            }
        }

        // Apply a relatively strict NMS (0.30) to prune out thick overlapping boxes typically caused by low confidence thresholding.
        return { boxes: this.nms(boxes, 0.30), maxConf };
    }

    private nms(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
        if (boxes.length === 0) return [];
        boxes.sort((a, b) => b.confidence - a.confidence);

        const kept: BoundingBox[] = [];
        for (const box of boxes) {
            let keep = true;
            for (const keptBox of kept) {
                if (this.iou(box, keptBox) > iouThreshold) {
                    keep = false;
                    break;
                }
            }
            if (keep) kept.push(box);
        }
        return kept;
    }

    private iou(box1: BoundingBox, box2: BoundingBox): number {
        const x1 = Math.max(box1.x - box1.w / 2, box2.x - box2.w / 2);
        const y1 = Math.max(box1.y - box1.h / 2, box2.y - box2.h / 2);
        const x2 = Math.min(box1.x + box1.w / 2, box2.x + box2.w / 2);
        const y2 = Math.min(box1.y + box1.h / 2, box2.y + box2.h / 2);

        const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        if (interArea === 0) return 0;

        const box1Area = box1.w * box1.h;
        const box2Area = box2.w * box2.h;
        return interArea / (box1Area + box2Area - interArea);
    }

    async runTrackBYolo(canvas: HTMLCanvasElement): Promise<BatchProcessingResult> {
        if (!this.session) throw new Error("ONNX Session not initialized");

        const startInfer = performance.now();

        let tensor: ort.Tensor;
        let padX: number, padY: number;
        try {
            const preProcessed = this.preprocess(canvas);
            tensor = preProcessed.tensor;
            padX = preProcessed.padX;
            padY = preProcessed.padY;
        } catch (e) {
            console.error("Tensor preprocessing failed", e);
            throw e;
        }

        const inputName = this.session.inputNames[0];
        let rawResults: ort.InferenceSession.ReturnType;
        try {
            rawResults = await this.session.run({ [inputName]: tensor });
        } catch (e: any) {
            const errMsg = e.message || e.toString();
            // Handle dynamically exported models that expect fixed batch dimensions (e.g., [8, 3, 640, 640])
            const match = errMsg.match(/index: 0 Got: \d+ Expected: (\d+)/);
            if (match) {
                const requiredBatchSize = parseInt(match[1], 10);
                console.log(`Model expects batch size ${requiredBatchSize}. Auto-padding tensor to fulfill requirement...`);

                // Pad the existing tensor data with zeros up to the required batch size
                const originalData = tensor.data as Float32Array;
                const paddedData = new Float32Array(requiredBatchSize * 3 * 640 * 640);
                paddedData.set(originalData);

                tensor = new ort.Tensor('float32', paddedData, [requiredBatchSize, 3, 640, 640]);
                rawResults = await this.session.run({ [inputName]: tensor });
            } else {
                console.error("ONNX Runtime session.run() failed", e);
                throw e;
            }
        }

        const outputName = this.session.outputNames[0];
        const outputTensor = rawResults[outputName];

        if (!outputTensor || !outputTensor.data) {
            throw new Error(`Failed to extract valid ${outputName} tensor from ONNX results.`);
        }

        // Dynamically applying a balanced threshold (0.25) to accommodate both best.onnx (high conf) and roboflow.onnx (low conf output).
        const { boxes, maxConf } = this.postprocess(outputTensor, padX, padY, 0.25);

        const endInfer = performance.now();
        const shapeStr = outputTensor.dims.join('x');
        console.log(`✅ YOLOv8 detected ${boxes.length} pills in ${(endInfer - startInfer).toFixed(1)}ms. Shape: ${shapeStr}, MaxConf: ${maxConf.toFixed(3)}`);

        const startPost = performance.now();

        const bagClusters = PillDetector.clusterIntoBags(boxes);

        const counts = bagClusters.map(c => c.length).filter(l => l > 0);
        let expectedPerBag = 0;
        if (counts.length > 0) {
            const freq: Record<number, number> = {};
            let maxFreq = 0, mode = counts[0];
            counts.forEach(c => {
                freq[c] = (freq[c] || 0) + 1;
                if (freq[c] > maxFreq) { maxFreq = freq[c]; mode = c; }
            });
            expectedPerBag = mode;
        }

        const results = bagClusters.map(b => {
            const avgConf = b.length > 0 ? b.reduce((s, box) => s + box.confidence, 0) / b.length : 0;
            return {
                boxCount: b.length,
                confidenceAverage: avgConf,
                passedExpectedCount: expectedPerBag > 0 && b.length === expectedPerBag,
                boxes: b
            };
        });

        const overallPass = expectedPerBag > 0 && results.every(r => r.passedExpectedCount);
        const endPost = performance.now();

        const metrics: PipelineMetrics = {
            captureMs: 0,
            warpMs: 0,
            inferMs: endInfer - startInfer,
            postprocessMs: endPost - startPost,
            renderMs: 0,
            totalMs: 0,
            debugStr: `[${shapeStr}] MaxConf:${maxConf.toFixed(3)}`
        };

        return { results, metrics, overallPass, expectedPerBag };
    }

    async runTrackBDummy(tensor: ort.Tensor): Promise<{ inferMs: number, shape: string }> {
        if (!this.dummySession) throw new Error("Session not initialized for Track B");

        const startTime = performance.now();

        const inputName = this.dummySession.inputNames[0];
        const feeds: Record<string, ort.Tensor> = {};
        feeds[inputName] = tensor;

        const results = await this.dummySession.run(feeds);

        const endTime = performance.now();

        const outputName = this.dummySession.outputNames[0];
        const outputTensor = results[outputName];

        console.log(`✅ Track B: Dummy Inference completed. Output shape: ${outputTensor.dims.join('x')}`);

        return {
            inferMs: endTime - startTime,
            shape: outputTensor.dims.join('x')
        };
    }
}

export const MvpInferenceService = new InferenceService();
