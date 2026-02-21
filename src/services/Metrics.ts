export interface PipelineMetrics {
    captureMs: number;
    warpMs: number;
    inferMs: number;
    postprocessMs: number;
    renderMs: number;
    totalMs: number;
}

export interface InferenceResult {
    boxCount: number;
    confidenceAverage: number;
    passedExpectedCount?: boolean;
}

export interface BatchProcessingResult {
    results: InferenceResult[]; // Should be length 10
    metrics: PipelineMetrics;
    overallPass: boolean;
}
