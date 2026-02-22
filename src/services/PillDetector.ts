import { BoundingBox } from './Metrics';

/**
 * PillDetector — Uses OpenCV.js to detect pills in an image via
 * color segmentation + contour analysis.
 * 
 * Pipeline:
 * 1. Convert to HSV
 * 2. Create masks for pill-colored regions (white, blue, yellow)
 * 3. Morphological cleanup
 * 4. Find contours
 * 5. Filter by size/circularity → emit bounding boxes
 */
export class PillDetector {

    /**
     * Detect pills in an image loaded onto a canvas.
     * Returns normalized (0-1) bounding boxes.
     */
    static detectFromImage(imgElement: HTMLImageElement): BoundingBox[] {
        const cv = (window as any).cv;
        if (!cv || !cv.Mat) {
            console.warn('OpenCV not loaded, cannot detect pills');
            return [];
        }

        // Draw image to a temporary canvas to get pixel data
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.naturalWidth || imgElement.width;
        canvas.height = imgElement.naturalHeight || imgElement.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return [];
        ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);

        const src = cv.imread(canvas);
        const W = src.cols;
        const H = src.rows;

        try {
            return this.detectPills(cv, src, W, H);
        } finally {
            src.delete();
        }
    }

    /**
     * Detect pills from a canvas element directly.
     */
    static detectFromCanvas(canvas: HTMLCanvasElement): BoundingBox[] {
        const cv = (window as any).cv;
        if (!cv || !cv.Mat) return [];

        const src = cv.imread(canvas);
        const W = src.cols;
        const H = src.rows;

        try {
            return this.detectPills(cv, src, W, H);
        } finally {
            src.delete();
        }
    }

    private static detectPills(cv: any, src: any, W: number, H: number): BoundingBox[] {
        const hsv = new cv.Mat();
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const combinedMask = new cv.Mat();

        try {
            cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
            const rgb = hsv.clone();
            cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
            cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
            rgb.delete();

            // --- Approach 1: Color masks ---
            // White pills: high value, low saturation
            const whiteLow = new cv.Mat(H, W, cv.CV_8UC3, [0, 0, 180, 0]);
            const whiteHigh = new cv.Mat(H, W, cv.CV_8UC3, [180, 60, 255, 0]);
            const whiteMask = new cv.Mat();
            cv.inRange(hsv, whiteLow, whiteHigh, whiteMask);
            whiteLow.delete(); whiteHigh.delete();

            // Blue pills: hue ~100-130
            const blueLow = new cv.Mat(H, W, cv.CV_8UC3, [90, 40, 100, 0]);
            const blueHigh = new cv.Mat(H, W, cv.CV_8UC3, [130, 255, 255, 0]);
            const blueMask = new cv.Mat();
            cv.inRange(hsv, blueLow, blueHigh, blueMask);
            blueLow.delete(); blueHigh.delete();

            // Yellow pills: hue ~15-35
            const yellowLow = new cv.Mat(H, W, cv.CV_8UC3, [15, 50, 150, 0]);
            const yellowHigh = new cv.Mat(H, W, cv.CV_8UC3, [40, 255, 255, 0]);
            const yellowMask = new cv.Mat();
            cv.inRange(hsv, yellowLow, yellowHigh, yellowMask);
            yellowLow.delete(); yellowHigh.delete();

            // Combine all color masks
            cv.bitwise_or(whiteMask, blueMask, combinedMask);
            cv.bitwise_or(combinedMask, yellowMask, combinedMask);
            whiteMask.delete(); blueMask.delete(); yellowMask.delete();

            // --- Approach 2: Edge-based circle detection on gray ---
            cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 1.5);

            // Threshold the gray for bright objects (pills tend to be bright)
            const brightMask = new cv.Mat();
            cv.threshold(blurred, brightMask, 170, 255, cv.THRESH_BINARY);

            // Combine with color mask
            cv.bitwise_or(combinedMask, brightMask, combinedMask);
            brightMask.delete();

            // Morphological cleanup — close gaps, remove noise
            const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
            cv.morphologyEx(combinedMask, combinedMask, cv.MORPH_CLOSE, kernel);
            cv.morphologyEx(combinedMask, combinedMask, cv.MORPH_OPEN, kernel);
            kernel.delete();

            // Find contours
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(combinedMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            const boxes: BoundingBox[] = [];
            const minArea = (W * H) * 0.0003;  // Min ~0.03% of image
            const maxArea = (W * H) * 0.02;     // Max ~2% of image

            for (let i = 0; i < contours.size(); i++) {
                const contour = contours.get(i);
                const area = cv.contourArea(contour);

                if (area < minArea || area > maxArea) continue;

                // Check circularity — pills are roughly round/oval
                const perimeter = cv.arcLength(contour, true);
                const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
                if (circularity < 0.3) continue;  // Reject very non-circular shapes

                const rect = cv.boundingRect(contour);

                // Aspect ratio filter — pills shouldn't be too elongated
                const aspect = Math.max(rect.width, rect.height) / Math.min(rect.width, rect.height);
                if (aspect > 3.0) continue;

                // Determine label by dominant color in the region
                const label = this.classifyPillColor(cv, hsv, rect);

                boxes.push({
                    x: (rect.x + rect.width / 2) / W,
                    y: (rect.y + rect.height / 2) / H,
                    w: rect.width / W,
                    h: rect.height / H,
                    confidence: Math.min(0.99, 0.8 + circularity * 0.2),
                    label
                });
            }

            contours.delete();
            hierarchy.delete();

            // Deduplicate overlapping boxes (NMS-like)
            return this.nonMaxSuppression(boxes, 0.4);

        } finally {
            hsv.delete();
            gray.delete();
            blurred.delete();
            combinedMask.delete();
        }
    }

    /**
     * Classify pill color by sampling the HSV values in the bounding rect
     */
    private static classifyPillColor(cv: any, hsv: any, rect: { x: number, y: number, width: number, height: number }): string {
        const roi = hsv.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
        const mean = cv.mean(roi);
        roi.delete();

        const h = mean[0]; // Hue
        const s = mean[1]; // Saturation

        if (s < 40) return '흰색 알약';
        if (h >= 90 && h <= 130) return '파란색 알약';
        if (h >= 15 && h <= 40) return '노란색 알약';
        if (h >= 0 && h <= 15) return '분홍색 알약';
        return '알약';
    }

    /**
     * Simple Non-Maximum Suppression to remove duplicate detections
     */
    private static nonMaxSuppression(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
        // Sort by confidence descending
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
        const areaA = a.w * a.h;
        const areaB = b.w * b.h;
        const union = areaA + areaB - intersection;

        return union > 0 ? intersection / union : 0;
    }
}
