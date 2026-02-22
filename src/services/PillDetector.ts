import { BoundingBox } from './Metrics';

/**
 * PillDetector v6 — HoughCircles only, no contours
 *
 * Contour-based detection creates too many false positives
 * (bag labels, text, edges) even with strict circularity.
 * HoughCircles specifically detects circular objects = pills.
 *
 * - Center ROI crop to exclude background
 * - Multi-pass HoughCircles with decreasing sensitivity
 * - Strict brightness filter (pills are bright)
 * - NMS deduplication across passes
 */
export class PillDetector {

    private static readonly ROI_MARGIN_X = 0.08;
    private static readonly ROI_MARGIN_TOP = 0.10;
    private static readonly ROI_MARGIN_BOTTOM = 0.05;

    static detectFromImage(imgElement: HTMLImageElement): BoundingBox[] {
        const cv = (window as any).cv;
        if (!cv || !cv.Mat) return [];
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.naturalWidth || imgElement.width;
        canvas.height = imgElement.naturalHeight || imgElement.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return [];
        ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
        const src = cv.imread(canvas);
        try { return this.detect(cv, src); }
        finally { src.delete(); }
    }

    static detectFromCanvas(canvas: HTMLCanvasElement): BoundingBox[] {
        const cv = (window as any).cv;
        if (!cv || !cv.Mat) return [];
        const src = cv.imread(canvas);
        try { return this.detect(cv, src); }
        finally { src.delete(); }
    }

    private static detect(cv: any, src: any): BoundingBox[] {
        const W = src.cols;
        const H = src.rows;

        // ROI crop — exclude background edges
        const roiX = Math.round(W * this.ROI_MARGIN_X);
        const roiY = Math.round(H * this.ROI_MARGIN_TOP);
        const roiW = Math.round(W * (1 - 2 * this.ROI_MARGIN_X));
        const roiH = Math.round(H * (1 - this.ROI_MARGIN_TOP - this.ROI_MARGIN_BOTTOM));
        const roi = src.roi(new cv.Rect(roiX, roiY, roiW, roiH));

        try {
            const boxes = this.detectCircles(cv, roi, roiW, roiH);

            // Convert coordinates back to full image space
            const fullBoxes = boxes.map(box => ({
                ...box,
                x: (box.x * roiW + roiX) / W,
                y: (box.y * roiH + roiY) / H,
                w: (box.w * roiW) / W,
                h: (box.h * roiH) / H,
            }));

            console.log(`🔍 ROI[${roiW}x${roiH}] → ${fullBoxes.length} pills detected`);
            return fullBoxes;
        } finally {
            roi.delete();
        }
    }

    /**
     * Multi-pass HoughCircles with decreasing sensitivity
     * Pass 1: strict (high confidence detections)
     * Pass 2: moderate
     * Pass 3: sensitive (catch remaining pills)
     * All merged via NMS
     */
    private static detectCircles(cv: any, src: any, W: number, H: number): BoundingBox[] {
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const hsv = new cv.Mat();

        try {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // Strong blur to reduce screen moiré and noise
            const ksize = Math.max(7, Math.round(Math.min(W, H) * 0.008) | 1);
            cv.GaussianBlur(gray, blurred, new cv.Size(ksize, ksize), 2);

            // HSV for color classification
            const rgb = new cv.Mat();
            cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
            cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
            rgb.delete();

            const minDim = Math.min(W, H);
            // Pills are substantial circles — at least 1.5% of min dimension
            const minR = Math.max(8, Math.round(minDim * 0.018));
            const maxR = Math.round(minDim * 0.065);
            const minDist = Math.round(minR * 2.2);

            const allBoxes: BoundingBox[] = [];

            // Multi-pass with different accumulator thresholds
            const passes = [
                { param1: 80, param2: 35, confBonus: 0.15 },  // strict
                { param1: 70, param2: 25, confBonus: 0.08 },  // moderate
                { param1: 60, param2: 18, confBonus: 0.0 },   // sensitive
            ];

            for (const pass of passes) {
                const circles = new cv.Mat();
                cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT,
                    1, minDist, pass.param1, pass.param2, minR, maxR);

                for (let i = 0; i < circles.cols; i++) {
                    const cx = circles.data32F[i * 3];
                    const cy = circles.data32F[i * 3 + 1];
                    const r = circles.data32F[i * 3 + 2];

                    // ROI for brightness check
                    const rx = Math.max(0, Math.round(cx - r * 0.7));
                    const ry = Math.max(0, Math.round(cy - r * 0.7));
                    const rw = Math.min(Math.round(r * 1.4), W - rx);
                    const rh = Math.min(Math.round(r * 1.4), H - ry);
                    if (rw <= 0 || rh <= 0) continue;

                    // Brightness — pills should be notably bright
                    const roiGray = gray.roi(new cv.Rect(rx, ry, rw, rh));
                    const meanBright = cv.mean(roiGray);
                    roiGray.delete();
                    if (meanBright[0] < 130) continue;

                    // Color classification
                    const roiHsv = hsv.roi(new cv.Rect(rx, ry, rw, rh));
                    const cm = cv.mean(roiHsv);
                    roiHsv.delete();
                    const label = this.classifyColor(cm[0], cm[1]);

                    const d = r * 2;
                    const conf = Math.min(0.99, 0.72 + (meanBright[0] / 255) * 0.15 + pass.confBonus);

                    allBoxes.push({
                        x: cx / W, y: cy / H, w: d / W, h: d / H,
                        confidence: conf, label
                    });
                }
                circles.delete();
            }

            return this.nms(allBoxes, 0.3);
        } finally {
            gray.delete();
            blurred.delete();
            hsv.delete();
        }
    }

    /**
     * Group pills into bags using gap-based x-coordinate clustering
     */
    static clusterIntoBags(boxes: BoundingBox[]): BoundingBox[][] {
        if (boxes.length === 0) return [];
        const sorted = [...boxes].sort((a, b) => a.x - b.x);
        const avgWidth = sorted.reduce((s, b) => s + b.w, 0) / sorted.length;
        // Gap = at least 2x pill width or 3% of image
        const gapThreshold = Math.max(avgWidth * 2.0, 0.025);

        const clusters: BoundingBox[][] = [[sorted[0]]];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].x - sorted[i - 1].x > gapThreshold) {
                clusters.push([]);
            }
            clusters[clusters.length - 1].push(sorted[i]);
        }
        return clusters;
    }

    private static classifyColor(h: number, s: number): string {
        if (s < 30) return '흰색';
        if (h >= 90 && h <= 130) return '파란색';
        if (h >= 15 && h <= 40) return '노란색';
        if (h >= 0 && h <= 15) return '분홍색';
        return '알약';
    }

    private static nms(boxes: BoundingBox[], threshold: number): BoundingBox[] {
        const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
        const kept: BoundingBox[] = [];
        for (const box of sorted) {
            if (!kept.some(e => this.iou(box, e) > threshold)) kept.push(box);
        }
        return kept;
    }

    private static iou(a: BoundingBox, b: BoundingBox): number {
        const ax1 = a.x - a.w / 2, ay1 = a.y - a.h / 2, ax2 = a.x + a.w / 2, ay2 = a.y + a.h / 2;
        const bx1 = b.x - b.w / 2, by1 = b.y - b.h / 2, bx2 = b.x + b.w / 2, by2 = b.y + b.h / 2;
        const inter = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1)) * Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
        const union = a.w * a.h + b.w * b.h - inter;
        return union > 0 ? inter / union : 0;
    }
}
