import { BoundingBox } from './Metrics';

/**
 * PillDetector v4 — Reliable pill counting
 *
 * Key improvements:
 * - Otsu threshold (global, not adaptive) → less noise
 * - Heavy morphological cleanup (open + close with large kernel)
 * - Strict circularity filter (pills are round, text is not)
 * - Large minimum area (pills are substantial, not tiny dots)
 * - Color validation from HSV
 * - HoughCircles as backup
 * - NMS deduplication
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

        const contourBoxes = this.detectByContours(cv, src, W, H);
        const circleBoxes = this.detectByCircles(cv, src, W, H);
        const merged = this.nms([...contourBoxes, ...circleBoxes], 0.3);

        console.log(`🔍 Detection: ${contourBoxes.length} contours + ${circleBoxes.length} circles → ${merged.length} pills`);
        return merged;
    }

    /**
     * Contour-based detection with strict filtering:
     * 1. Otsu threshold (global binary — clean)
     * 2. Heavy morphological cleanup (remove text, keep blobs)
     * 3. Contour analysis with circularity > 0.5
     * 4. Minimum area = relative to image size
     */
    private static detectByContours(cv: any, src: any, W: number, H: number): BoundingBox[] {
        const gray = new cv.Mat();
        const binary = new cv.Mat();
        const hsv = new cv.Mat();

        try {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // Prepare HSV for color classification
            const rgb = new cv.Mat();
            cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
            cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
            rgb.delete();

            // Gaussian blur → Otsu threshold
            const blurred = new cv.Mat();
            cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 2);
            cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
            blurred.delete();

            // Heavy morphological cleanup — large kernel removes text but keeps pill-sized blobs
            const minDim = Math.min(W, H);
            const kernelSize = Math.max(5, Math.round(minDim * 0.008));
            const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kernelSize, kernelSize));

            // Open: remove small noise (text, edges, artifacts)
            cv.morphologyEx(binary, binary, cv.MORPH_OPEN, kernel);
            // Close: fill gaps within pills
            cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel);
            kernel.delete();

            // Find contours
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            // Size thresholds based on image
            // A pill should be at least ~1% of minDim in radius → area ≥ (minDim*0.01)^2 * π
            const pillMinRadius = minDim * 0.012;
            const pillMaxRadius = minDim * 0.06;
            const minArea = Math.PI * pillMinRadius * pillMinRadius;  // ~450px for 1080p
            const maxArea = Math.PI * pillMaxRadius * pillMaxRadius;  // ~11000px for 1080p

            const boxes: BoundingBox[] = [];

            for (let i = 0; i < contours.size(); i++) {
                const contour = contours.get(i);
                const area = cv.contourArea(contour);

                // Size filter
                if (area < minArea || area > maxArea) continue;

                // Circularity filter — this is KEY
                // circularity = 4π * area / perimeter² (1.0 = perfect circle)
                const perimeter = cv.arcLength(contour, true);
                if (perimeter === 0) continue;
                const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

                // Pills should be fairly round (circle≈1.0, square≈0.78)
                // Text characters are typically < 0.3
                if (circularity < 0.45) continue;

                // Bounding rect
                const rect = cv.boundingRect(contour);

                // Aspect ratio filter — pills are round/oval, not elongated
                const aspect = Math.max(rect.width, rect.height) / Math.min(rect.width, rect.height);
                if (aspect > 2.0) continue;

                // Brightness check — pills should be bright
                const roiGray = gray.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
                const meanBright = cv.mean(roiGray);
                roiGray.delete();
                if (meanBright[0] < 120) continue;

                // Color classification from HSV
                const roiHsv = hsv.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
                const colorMean = cv.mean(roiHsv);
                roiHsv.delete();
                const label = this.classifyColor(colorMean[0], colorMean[1]);

                const conf = Math.min(0.99, 0.7 + circularity * 0.2 + (meanBright[0] / 255) * 0.1);

                boxes.push({
                    x: (rect.x + rect.width / 2) / W,
                    y: (rect.y + rect.height / 2) / H,
                    w: rect.width / W,
                    h: rect.height / H,
                    confidence: conf,
                    label
                });
            }

            contours.delete();
            hierarchy.delete();
            return boxes;

        } finally {
            gray.delete();
            binary.delete();
            hsv.delete();
        }
    }

    /**
     * HoughCircles backup — finds well-defined circles
     */
    private static detectByCircles(cv: any, src: any, W: number, H: number): BoundingBox[] {
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const circles = new cv.Mat();

        try {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 2);

            const minDim = Math.min(W, H);
            const minR = Math.max(5, Math.round(minDim * 0.012));
            const maxR = Math.round(minDim * 0.06);

            cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT,
                1, minR * 2,
                80, 25,
                minR, maxR
            );

            const boxes: BoundingBox[] = [];
            for (let i = 0; i < circles.cols; i++) {
                const cx = circles.data32F[i * 3];
                const cy = circles.data32F[i * 3 + 1];
                const r = circles.data32F[i * 3 + 2];

                // Brightness check
                const rx = Math.max(0, Math.round(cx - r));
                const ry = Math.max(0, Math.round(cy - r));
                const rw = Math.min(Math.round(r * 2), W - rx);
                const rh = Math.min(Math.round(r * 2), H - ry);
                if (rw <= 0 || rh <= 0) continue;

                const roi = gray.roi(new cv.Rect(rx, ry, rw, rh));
                const m = cv.mean(roi);
                roi.delete();
                if (m[0] < 120) continue;

                const d = r * 2;
                boxes.push({
                    x: cx / W, y: cy / H, w: d / W, h: d / H,
                    confidence: Math.min(0.99, 0.80 + (m[0] / 255) * 0.15),
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
     * Group pills into bags by gap-based x-coordinate clustering
     */
    static clusterIntoBags(boxes: BoundingBox[]): BoundingBox[][] {
        if (boxes.length === 0) return [];
        const sorted = [...boxes].sort((a, b) => a.x - b.x);

        const avgWidth = sorted.reduce((s, b) => s + b.w, 0) / sorted.length;
        const gapThreshold = Math.max(avgWidth * 2.5, 0.03);

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
