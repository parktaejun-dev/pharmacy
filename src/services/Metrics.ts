export interface PipelineMetrics {
    captureMs: number;
    warpMs: number;
    inferMs: number;
    postprocessMs: number;
    renderMs: number;
    totalMs: number;
}

export interface BoundingBox {
    x: number;      // center x (0-1 normalized)
    y: number;      // center y (0-1 normalized)
    w: number;      // width (0-1 normalized)
    h: number;      // height (0-1 normalized)
    confidence: number;
    label: string;   // e.g. "pill", "capsule"
}

export interface InferenceResult {
    boxCount: number;
    confidenceAverage: number;
    passedExpectedCount?: boolean;
    boxes: BoundingBox[];  // detected pill bounding boxes
}

export interface BatchProcessingResult {
    results: InferenceResult[];
    metrics: PipelineMetrics;
    overallPass: boolean;
    expectedPerBag?: number;  // auto-detected from mode of cluster sizes
}
