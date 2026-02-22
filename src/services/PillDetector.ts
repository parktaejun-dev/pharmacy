import { BoundingBox } from './Metrics';

/**
 * PillDetector v5 — ROI crop + HoughCircles primary
 *
 * Key changes:
 * - Center ROI crop: ignore outer 15% to exclude background objects
 * - HoughCircles as PRIMARY detector (pills are definitively round)
 * - Contour-based as SECONDARY with very strict circularity (>0.65)
 * - Multi-pass HoughCircles with different param2 values for sensitivity
 */
export class PillDetector {

    // ROI margins — ignore outer edges where background objects appear
    private static readonly ROI_MARGIN_X = 0.10; // 10% from left/right
    private static readonly ROI_MARGIN_TOP = 0.12; // 12% from top (header area)
    private static readonly ROI_MARGIN_BOTTOM = 0.05; // 5% from bottom

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

        // Calculate ROI bounds
        const roiX = Math.round(W * this.ROI_MARGIN_X);
        const roiY = Math.round(H * this.ROI_MARGIN_TOP);
        const roiW = Math.round(W * (1 - 2 * this.ROI_MARGIN_X));
        const roiH = Math.round(H * (1 - this.ROI_MARGIN_TOP - this.ROI_MARGIN_BOTTOM));

        // Crop to ROI
        const roi = src.roi(new cv.Rect(roiX, roiY, roiW, roiH));

        try {
            // Primary: HoughCircles (multi-pass for better coverage)
            const circleBoxes = this.detectByCircles(cv, roi, roiW, roiH);

            // Secondary: Strict contour detection
            const contourBoxes = this.detectByContours(cv, roi, roiW, roiH);

            // Merge with NMS
            const merged = this.nms([...circleBoxes, ...contourBoxes], 0.3);

            // Convert coordinates back to full image space
            const fullBoxes = merged.map(box => ({
                ...box,
                x: (box.x * roiW + roiX) / W,
                y: (box.y * roiH + roiY) / H,
                w: (box.w * roiW) / W,
                h: (box.h * roiH) / H,
            }));

            console.log(`🔍 ROI[${roiX},${roiY} ${roiW}x${roiH}] → ${circleBoxes.length} circles + ${contourBoxes.length} contours → ${fullBoxes.length} pills`);
            return fullBoxes;

        } finally {
            roi.delete();
        }
    }

    /**
     * PRIMARY: HoughCircles with multi-pass sensitivity
     * Runs multiple passes with different param2 (accumulator threshold)
     * to catch both obvious and subtle circles
     */
    private static detectByCircles(cv: any, src: any, W: number, H: number): BoundingBox[] {
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const hsv = new cv.Mat();

        try {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 2);

            // Prepare HSV for color
            const rgb = new cv.Mat();
            cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
            cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
            rgb.delete();

            const minDim = Math.min(W, H);
            const minR = Math.max(5, Math.round(minDim * 0.015));
            const maxR = Math.round(minDim * 0.07);
            const minDist = minR * 2;

            const allBoxes: BoundingBox[] = [];

            // Multi-pass: different param2 values (lower = more sensitive)
            for (const param2 of [30, 22, 16]) {
                const circles = new cv.Mat();
                cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT,
                    1,        // dp
                    minDist,  // minDist between centers
                    80,       // param1 (Canny upper)
                    param2,   // accumulator threshold
                    minR, maxR
                );

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

                    const roiGray = gray.roi(new cv.Rect(rx, ry, rw, rh));
                    const meanBright = cv.mean(roiGray);
                    roiGray.delete();
                    if (meanBright[0] < 110) continue;

                    // Color from HSV
                    const roiHsv = hsv.roi(new cv.Rect(rx, ry, rw, rh));
                    const colorMean = cv.mean(roiHsv);
                    roiHsv.delete();
                    const label = this.classifyColor(colorMean[0], colorMean[1]);

                    const d = r * 2;
                    const conf = Math.min(0.99, 0.75 + (meanBright[0] / 255) * 0.15 + (param2 > 25 ? 0.1 : 0));
                    allBoxes.push({
                        x: cx / W, y: cy / H, w: d / W, h: d / H,
                        confidence: conf, label
                    });
                }
                circles.delete();
            }

            // Deduplicate across passes
            return this.nms(allBoxes, 0.3);

        } finally {
            gray.delete();
            blurred.delete();
            hsv.delete();
        }
    }

    /**
     * SECONDARY: Contour-based with VERY strict circularity (>0.65)
     * Only catches pills that HoughCircles might miss
     */
    private static detectByContours(cv: any, src: any, W: number, H: number): BoundingBox[] {
        const gray = new cv.Mat();
        const binary = new cv.Mat();
        const hsv = new cv.Mat();

        try {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            const rgb = new cv.Mat();
            cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
            cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
            rgb.delete();

            // Otsu threshold
            const blurred = new cv.Mat();
            cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 2);
            cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
            blurred.delete();

            // Heavy morphological cleanup
            const minDim = Math.min(W, H);
            const kSize = Math.max(5, Math.round(minDim * 0.01));
            const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kSize, kSize));
            cv.morphologyEx(binary, binary, cv.MORPH_OPEN, kernel);
            cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel);
            kernel.delete();

            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            const pillMinR = minDim * 0.015;
            const pillMaxR = minDim * 0.07;
            const minArea = Math.PI * pillMinR * pillMinR;
            const maxArea = Math.PI * pillMaxR * pillMaxR;

            const boxes: BoundingBox[] = [];

            for (let i = 0; i < contours.size(); i++) {
                const contour = contours.get(i);
                const area = cv.contourArea(contour);
                if (area < minArea || area > maxArea) continue;

                const perimeter = cv.arcLength(contour, true);
                if (perimeter === 0) continue;
                const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

                // VERY strict circularity — only obvious circles
                if (circularity < 0.65) continue;

                const rect = cv.boundingRect(contour);
                const aspect = Math.max(rect.width, rect.height) / Math.min(rect.width, rect.height);
                if (aspect > 1.8) continue;

                const roiGray = gray.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
                const meanBright = cv.mean(roiGray);
                roiGray.delete();
                if (meanBright[0] < 120) continue;

                const roiHsv = hsv.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
                const colorMean = cv.mean(roiHsv);
                roiHsv.delete();
                const label = this.classifyColor(colorMean[0], colorMean[1]);

                boxes.push({
                    x: (rect.x + rect.width / 2) / W,
                    y: (rect.y + rect.height / 2) / H,
                    w: rect.width / W,
                    h: rect.height / H,
                    confidence: Math.min(0.99, 0.65 + circularity * 0.25 + (meanBright[0] / 255) * 0.1),
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
