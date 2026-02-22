import { BoundingBox } from './Metrics';

/**
 * PillDetector v3 — Multi-strategy pill detection
 *
 * Strategy 1: Adaptive threshold + connected components
 *   - Finds bright blobs (pills are brighter than bag background)
 *   - More robust than HoughCircles for non-perfect circles
 *
 * Strategy 2: HoughCircles (backup, relaxed params)
 *
 * Bag Grouping: Gap-based clustering on x-coordinates
 *   - Groups detected pills into bags by finding natural gaps
 */
export class PillDetector {

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
        try {
            return this.detect(cv, src);
        } finally {
            src.delete();
        }
    }

    static detectFromCanvas(canvas: HTMLCanvasElement): BoundingBox[] {
        const cv = (window as any).cv;
        if (!cv || !cv.Mat) return [];

        const src = cv.imread(canvas);
        try {
            return this.detect(cv, src);
        } finally {
            src.delete();
        }
    }

    private static detect(cv: any, src: any): BoundingBox[] {
        const W = src.cols;
        const H = src.rows;

        // Strategy 1: Adaptive threshold + connected components
        const blobBoxes = this.detectByBlobs(cv, src, W, H);

        // Strategy 2: HoughCircles (relaxed)
        const circleBoxes = this.detectByCircles(cv, src, W, H);

        // Merge both strategies with NMS
        const merged = this.nonMaxSuppression([...blobBoxes, ...circleBoxes], 0.3);

        console.log(`🔍 Detection: ${blobBoxes.length} blobs + ${circleBoxes.length} circles → ${merged.length} pills after NMS`);

        return merged;
    }

    /**
     * Strategy 1: Adaptive threshold → connected components → filter by size/shape
     */
    private static detectByBlobs(cv: any, src: any, W: number, H: number): BoundingBox[] {
        const gray = new cv.Mat();
        const binary = new cv.Mat();
        const labels = new cv.Mat();
        const stats = new cv.Mat();
        const centroids = new cv.Mat();
        const hsv = new cv.Mat();

        try {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // Prepare HSV for color classification
            const rgb = new cv.Mat();
            cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
            cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
            rgb.delete();

            // Gaussian blur to reduce noise
            const blurred = new cv.Mat();
            cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 1.5);

            // Adaptive threshold — finds bright objects against local background
            cv.adaptiveThreshold(
                blurred, binary,
                255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY,
                31,   // block size (neighborhood)
                -8    // C constant (negative = find bright spots)
            );
            blurred.delete();

            // Morphological cleanup
            const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
            cv.morphologyEx(binary, binary, cv.MORPH_OPEN, kernel);   // remove noise
            cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel);  // fill gaps
            kernel.delete();

            // Connected components with stats
            const numLabels = cv.connectedComponentsWithStats(binary, labels, stats, centroids);

            const boxes: BoundingBox[] = [];
            const minDim = Math.min(W, H);
            const minArea = (minDim * 0.005) ** 2;   // ~0.5% of min dimension squared
            const maxArea = (minDim * 0.06) ** 2;     // ~6% of min dimension squared

            for (let i = 1; i < numLabels; i++) { // skip background (label 0)
                const x = stats.intAt(i, cv.CC_STAT_LEFT);
                const y = stats.intAt(i, cv.CC_STAT_TOP);
                const w = stats.intAt(i, cv.CC_STAT_WIDTH);
                const h = stats.intAt(i, cv.CC_STAT_HEIGHT);
                const area = stats.intAt(i, cv.CC_STAT_AREA);

                // Size filter
                if (area < minArea || area > maxArea) continue;

                // Aspect ratio filter — pills are roughly round/oval
                const aspect = Math.max(w, h) / Math.min(w, h);
                if (aspect > 2.5) continue;

                // Solidity check — area vs bounding box area
                const solidity = area / (w * h);
                if (solidity < 0.3) continue;

                // Brightness check — pills should be bright
                const roiX = Math.max(0, x);
                const roiY = Math.max(0, y);
                const roiW = Math.min(w, W - roiX);
                const roiH = Math.min(h, H - roiY);
                if (roiW <= 0 || roiH <= 0) continue;

                const roi = gray.roi(new cv.Rect(roiX, roiY, roiW, roiH));
                const meanBright = cv.mean(roi);
                roi.delete();
                if (meanBright[0] < 100) continue;

                // Color classification
                const colorRoi = hsv.roi(new cv.Rect(roiX, roiY, roiW, roiH));
                const colorMean = cv.mean(colorRoi);
                colorRoi.delete();
                const label = this.classifyColor(colorMean[0], colorMean[1]);

                boxes.push({
                    x: (x + w / 2) / W,
                    y: (y + h / 2) / H,
                    w: w / W,
                    h: h / H,
                    confidence: Math.min(0.99, 0.75 + solidity * 0.2 + (meanBright[0] / 255) * 0.05),
                    label
                });
            }

            return boxes;

        } finally {
            gray.delete();
            binary.delete();
            labels.delete();
            stats.delete();
            centroids.delete();
            hsv.delete();
        }
    }

    /**
     * Strategy 2: HoughCircles with relaxed parameters
     */
    private static detectByCircles(cv: any, src: any, W: number, H: number): BoundingBox[] {
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const circles = new cv.Mat();

        try {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            const ksize = Math.max(5, Math.round(Math.min(W, H) * 0.006) | 1);
            cv.GaussianBlur(gray, blurred, new cv.Size(ksize, ksize), 1.5);

            const minDim = Math.min(W, H);
            const minRadius = Math.max(3, Math.round(minDim * 0.006));
            const maxRadius = Math.round(minDim * 0.05);
            const minDist = minRadius * 1.8;

            cv.HoughCircles(
                blurred, circles, cv.HOUGH_GRADIENT,
                1, minDist,
                60,     // param1 — lower Canny threshold for more edges
                18,     // param2 — lower accumulator threshold for more detections
                minRadius, maxRadius
            );

            const boxes: BoundingBox[] = [];
            for (let i = 0; i < circles.cols; i++) {
                const cx = circles.data32F[i * 3];
                const cy = circles.data32F[i * 3 + 1];
                const r = circles.data32F[i * 3 + 2];

                // Brightness check
                const roiX = Math.max(0, Math.round(cx - r));
                const roiY = Math.max(0, Math.round(cy - r));
                const roiW = Math.min(Math.round(r * 2), W - roiX);
                const roiH = Math.min(Math.round(r * 2), H - roiY);
                if (roiW <= 0 || roiH <= 0) continue;

                const roi = gray.roi(new cv.Rect(roiX, roiY, roiW, roiH));
                const meanVal = cv.mean(roi);
                roi.delete();
                if (meanVal[0] < 100) continue;

                const d = r * 2;
                boxes.push({
                    x: cx / W, y: cy / H,
                    w: d / W, h: d / H,
                    confidence: Math.min(0.99, 0.80 + (meanVal[0] / 255) * 0.15),
                    label: '알약'
                });
            }
            return boxes;

        } finally {
            gray.delete();
            blurred.delete();
            circles.delete();
        }
    }

    /**
     * Group detected pills into bags using gap-based clustering on x-coordinates
     */
    static clusterIntoBags(boxes: BoundingBox[]): BoundingBox[][] {
        if (boxes.length === 0) return [];

        // Sort by x coordinate
        const sorted = [...boxes].sort((a, b) => a.x - b.x);

        // Find natural gaps in x-coordinates
        const gaps: { idx: number, gap: number }[] = [];
        for (let i = 1; i < sorted.length; i++) {
            gaps.push({ idx: i, gap: sorted[i].x - sorted[i - 1].x });
        }

        // Average pill width as reference for gap threshold
        const avgWidth = sorted.reduce((s, b) => s + b.w, 0) / sorted.length;
        const gapThreshold = Math.max(avgWidth * 2.5, 0.03); // at least 3% gap or 2.5x pill width

        // Split into clusters at significant gaps
        const clusters: BoundingBox[][] = [[]];
        clusters[0].push(sorted[0]);

        for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i].x - sorted[i - 1].x;
            if (gap > gapThreshold) {
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

    private static nonMaxSuppression(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
        const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
        const kept: BoundingBox[] = [];
        for (const box of sorted) {
            if (!kept.some(e => this.iou(box, e) > iouThreshold)) {
                kept.push(box);
            }
        }
        return kept;
    }

    private static iou(a: BoundingBox, b: BoundingBox): number {
        const ax1 = a.x - a.w / 2, ay1 = a.y - a.h / 2;
        const ax2 = a.x + a.w / 2, ay2 = a.y + a.h / 2;
        const bx1 = b.x - b.w / 2, by1 = b.y - b.h / 2;
        const bx2 = b.x + b.w / 2, by2 = b.y + b.h / 2;
        const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
        const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
        const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
        const union = a.w * a.h + b.w * b.h - inter;
        return union > 0 ? inter / union : 0;
    }
}
