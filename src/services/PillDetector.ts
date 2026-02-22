import { BoundingBox } from './Metrics';

/**
 * PillDetector — Uses OpenCV.js Hough Circle detection
 * to find round pill-shaped objects.
 *
 * Pipeline:
 * 1. Convert to grayscale
 * 2. Gaussian blur to reduce noise
 * 3. HoughCircles to find circular objects
 * 4. Filter by size
 * 5. Classify color from original image
 * 6. NMS deduplication
 */
export class PillDetector {

    static detectFromImage(imgElement: HTMLImageElement): BoundingBox[] {
        const cv = (window as any).cv;
        if (!cv || !cv.Mat) {
            console.warn('OpenCV not loaded');
            return [];
        }

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
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const circles = new cv.Mat();
        const hsv = new cv.Mat();

        try {
            // Convert to grayscale
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // Prepare HSV for color classification later
            const rgb = new cv.Mat();
            cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
            cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
            rgb.delete();

            // Heavy blur to smooth out textures/text and keep only blob shapes
            const ksize = Math.max(5, Math.round(Math.min(W, H) * 0.008) | 1);
            cv.GaussianBlur(gray, blurred, new cv.Size(ksize, ksize), 2);

            // --- Hough Circle Detection ---
            // Params tuned for pills in pharmacy bag images:
            // - dp=1: full resolution accumulator
            // - minDist: minimum distance between circle centers
            // - param1: Canny edge upper threshold
            // - param2: accumulator threshold (lower = more circles)
            // - minRadius/maxRadius: expected pill size range
            const minDim = Math.min(W, H);
            const minRadius = Math.max(3, Math.round(minDim * 0.008));   // ~0.8% of image
            const maxRadius = Math.round(minDim * 0.04);                  // ~4% of image
            const minDist = minRadius * 2;                                 // pills don't overlap

            cv.HoughCircles(
                blurred,
                circles,
                cv.HOUGH_GRADIENT,
                1,              // dp
                minDist,        // minDist between centers
                80,             // param1 (Canny upper)
                25,             // param2 (accumulator threshold - lower = more sensitive)
                minRadius,
                maxRadius
            );

            console.log(`🔍 HoughCircles found ${circles.cols} candidates (radius range: ${minRadius}-${maxRadius}px)`);

            const boxes: BoundingBox[] = [];

            for (let i = 0; i < circles.cols; i++) {
                const cx = circles.data32F[i * 3];
                const cy = circles.data32F[i * 3 + 1];
                const r = circles.data32F[i * 3 + 2];

                // Additional validation: check if the circle region is
                // actually bright enough to be a pill (not part of dark background)
                const roiX = Math.max(0, Math.round(cx - r));
                const roiY = Math.max(0, Math.round(cy - r));
                const roiW = Math.min(Math.round(r * 2), W - roiX);
                const roiH = Math.min(Math.round(r * 2), H - roiY);

                if (roiW <= 0 || roiH <= 0) continue;

                const roi = gray.roi(new cv.Rect(roiX, roiY, roiW, roiH));
                const meanVal = cv.mean(roi);
                roi.delete();

                // Pills should be relatively bright (white/blue/yellow)
                if (meanVal[0] < 120) continue;

                // Classify color
                const colorRoi = hsv.roi(new cv.Rect(roiX, roiY, roiW, roiH));
                const colorMean = cv.mean(colorRoi);
                colorRoi.delete();
                const label = this.classifyColor(colorMean[0], colorMean[1]);

                const diameter = r * 2;
                boxes.push({
                    x: cx / W,
                    y: cy / H,
                    w: diameter / W,
                    h: diameter / H,
                    confidence: Math.min(0.99, 0.85 + (meanVal[0] / 255) * 0.15),
                    label
                });
            }

            return this.nonMaxSuppression(boxes, 0.3);

        } finally {
            gray.delete();
            blurred.delete();
            circles.delete();
            hsv.delete();
        }
    }

    private static classifyColor(h: number, s: number): string {
        if (s < 30) return '흰색 알약';
        if (h >= 90 && h <= 130) return '파란색 알약';
        if (h >= 15 && h <= 40) return '노란색 알약';
        if (h >= 0 && h <= 15) return '분홍색 알약';
        return '알약';
    }

    private static nonMaxSuppression(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
        const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
        const kept: BoundingBox[] = [];

        for (const box of sorted) {
            let shouldKeep = true;
            for (const existing of kept) {
                if (this.iou(box, existing) > iouThreshold) {
                    shouldKeep = false;
                    break;
                }
            }
            if (shouldKeep) kept.push(box);
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

        const intersection = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
        const union = a.w * a.h + b.w * b.h - intersection;
        return union > 0 ? intersection / union : 0;
    }
}
