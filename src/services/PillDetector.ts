import { BoundingBox } from './Metrics';

/**
 * PillDetector v15 — Ultra-Aggressive Hybrid
 *
 * Pipeline:
 * 1. Ultra-aggressive HoughCircles (param2 as low as 10) to find ALL possible pill candidates (including distorted/faint ones).
 * 2. Strict HSV Color Mask limits candidates to ONLY pill-colored regions.
 * 3. Text/noise found by Hough is purely rejected because its mask mean is 0.
 * 4. Y-position filter removed because color mask handles text robustly.
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

    /**
     * Contrast Limited Adaptive Histogram Equalization (CLAHE)
     * Removes monitor glare and normalizes exposure across the entire canvas.
     * This mutates the provided canvas IN-PLACE to act as a preprocessor for YOLO inference.
     */
    static applyCLAHE(canvas: HTMLCanvasElement): void {
        const cv = (window as any).cv;
        if (!cv || !cv.Mat) return; // Fail gracefully if OpenCV not loaded

        const src = cv.imread(canvas);
        const lab = new cv.Mat();
        const dest = new cv.Mat();

        try {
            // Convert to LAB color space to isolate Luminance (lightness)
            cv.cvtColor(src, lab, cv.COLOR_RGBA2RGB); // First drop Alpha
            cv.cvtColor(lab, lab, cv.COLOR_RGB2Lab);

            // Split into L, A, B channels
            const channels = new cv.MatVector();
            cv.split(lab, channels);

            const lChannel = channels.get(0);

            // Apply CLAHE to the L-channel
            const clahe = new cv.CLAHE(3.0, new cv.Size(8, 8)); // ClipLimit=3.0, TileGridSize=8x8
            clahe.apply(lChannel, lChannel);

            // Merge back and convert to RGBA
            cv.merge(channels, lab);
            cv.cvtColor(lab, dest, cv.COLOR_Lab2RGB);
            cv.cvtColor(dest, dest, cv.COLOR_RGB2RGBA); // Restore Alpha for canvas compatibility

            // Draw back onto the canvas
            cv.imshow(canvas, dest);

            // Cleanup local references inside the try block
            lChannel.delete();
            channels.delete();
            clahe.delete();
        } catch (e) {
            console.error("OpenCV CLAHE application failed", e);
        } finally {
            src.delete();
            lab.delete();
            dest.delete();
        }
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
        const minDim = Math.min(W, H);

        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const rgb = new cv.Mat();
        const hsv = new cv.Mat();

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
        cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
        rgb.delete();

        // 1. Generate exact Pill Color Mask
        const mask = this.createPillMask(cv, hsv);

        // 2. Prepare for HoughCircles
        // Moderate blur
        const blurSize = Math.max(3, Math.round(minDim * 0.005) | 1); // ~5px for 640px
        cv.GaussianBlur(gray, blurred, new cv.Size(blurSize, blurSize), 0, 0, cv.BORDER_DEFAULT);

        // Allow smaller minimum radius to catch angled/squished pills
        const minR = Math.max(7, Math.round(minDim * 0.010));  // ~6px for 640px
        const maxR = Math.min(60, Math.round(minDim * 0.060)); // ~38px for 640px
        const minDist = minR * 1.5; // Allow tight overlapping pills

        const boxes: BoundingBox[] = [];
        let totalCircles = 0, rejColor = 0;

        // Multi-pass HoughCircles: from comfortable to ultra-aggressive
        // Since we have the Color Mask, param2=10 is safe! It will find text/noise, but mask will reject them.
        const passes = [
            { p1: 65, p2: 18, baseConf: 0.85 },
            { p1: 50, p2: 14, baseConf: 0.70 },
            { p1: 40, p2: 10, baseConf: 0.55 } // Extremely sensitive pass
        ];

        for (const pass of passes) {
            const circles = new cv.Mat();
            cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, 1, minDist, pass.p1, pass.p2, minR, maxR);
            totalCircles += circles.cols;

            for (let i = 0; i < circles.cols; i++) {
                const cx = circles.data32F[i * 3];
                const cy = circles.data32F[i * 3 + 1];
                const r = circles.data32F[i * 3 + 2];

                // Note: No Y-position filter! We trust the color mask.

                // Sample the color mask around the center
                // Sample a slightly larger ROI (5x5) to tolerate slight center shifts
                const rx = Math.max(0, Math.round(cx - 2));
                const ry = Math.max(0, Math.round(cy - 2));
                const rw = Math.min(5, W - rx);
                const rh = Math.min(5, H - ry);
                if (rw <= 0 || rh <= 0) continue;

                const maskRoi = mask.roi(new cv.Rect(rx, ry, rw, rh));
                const maskMean = cv.mean(maskRoi)[0]; // 0 to 255
                maskRoi.delete();

                // If the center is NOT predominantly a pill color, reject it!
                // 128 means 50% of the center pixels must be pill-colored.
                if (maskMean < 128) {
                    rejColor++;
                    continue;
                }

                // Determine specific color label from HSV
                const hsvRoi = hsv.roi(new cv.Rect(rx, ry, rw, rh));
                const hsvMean = cv.mean(hsvRoi);
                hsvRoi.delete();
                const label = this.classifyColor(hsvMean[0], hsvMean[1]);

                const d = r * 2;
                // Add tiny bonus for strong color mask match
                const conf = Math.min(0.99, pass.baseConf + (maskMean / 255) * 0.1);

                boxes.push({
                    x: cx / W, y: cy / H, w: d / W, h: d / H,
                    confidence: conf, label
                });
            }
            circles.delete();
        }

        console.log(`🔍 [${W}x${H}] Hough found ${totalCircles} candidates → verified ${boxes.length} pills (rejColor=${rejColor})`);

        gray.delete(); blurred.delete(); hsv.delete(); mask.delete();

        // Strong NMS to clean up the ultra-aggressive detections
        return this.nms(boxes, 0.25);
    }

    private static createPillMask(cv: any, hsv: any): any {
        const masks: any[] = [];

        // Blue pills
        const mBlue = new cv.Mat();
        cv.inRange(hsv, new cv.Mat(1, 1, cv.CV_8UC3, [85, 30, 70, 0]),
            new cv.Mat(1, 1, cv.CV_8UC3, [135, 255, 255, 0]), mBlue);
        masks.push(mBlue);

        // Yellow pills
        const mYellow = new cv.Mat();
        cv.inRange(hsv, new cv.Mat(1, 1, cv.CV_8UC3, [12, 35, 100, 0]),
            new cv.Mat(1, 1, cv.CV_8UC3, [45, 255, 255, 0]), mYellow);
        masks.push(mYellow);

        // Pink/Red pills
        const mPink1 = new cv.Mat();
        cv.inRange(hsv, new cv.Mat(1, 1, cv.CV_8UC3, [0, 25, 80, 0]),
            new cv.Mat(1, 1, cv.CV_8UC3, [15, 255, 255, 0]), mPink1);
        const mPink2 = new cv.Mat();
        cv.inRange(hsv, new cv.Mat(1, 1, cv.CV_8UC3, [165, 25, 80, 0]),
            new cv.Mat(1, 1, cv.CV_8UC3, [180, 255, 255, 0]), mPink2);
        cv.bitwise_or(mPink1, mPink2, mPink1);
        masks.push(mPink1);
        mPink2.delete();

        // White pills (low sat, high value). Looser to handle shading under plastic.
        const mWhite = new cv.Mat();
        cv.inRange(hsv, new cv.Mat(1, 1, cv.CV_8UC3, [0, 0, 150, 0]),
            new cv.Mat(1, 1, cv.CV_8UC3, [180, 55, 255, 0]), mWhite);
        masks.push(mWhite);

        // Combine
        const combined = masks[0].clone();
        for (let i = 1; i < masks.length; i++) cv.bitwise_or(combined, masks[i], combined);
        masks.forEach(m => m.delete());

        // Fill small holes in mask and expand so the Hough center definitely hits it
        const kSize = 7;
        const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kSize, kSize));
        cv.morphologyEx(combined, combined, cv.MORPH_CLOSE, kernel);
        cv.dilate(combined, combined, kernel); // Expand to catch slightly off-center detections
        kernel.delete();

        return combined;
    }

    static clusterIntoBags(boxes: BoundingBox[]): BoundingBox[][] {
        if (boxes.length === 0) return [];
        const sorted = [...boxes].sort((a, b) => a.x - b.x);
        const avgWidth = sorted.reduce((s, b) => s + b.w, 0) / sorted.length;
        // Gap threshold for separating bags (increased multiplier to compensate for bounding box shrinkage heuristics)
        const gapThreshold = Math.max(avgWidth * 2.5, 0.035);

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
        if (s < 55) return '흰색/투명';
        if (h >= 85 && h <= 135) return '파란색';
        if (h >= 12 && h <= 45) return '노란색';
        if (h >= 0 && h <= 15 || h >= 165 && h <= 180) return '분홍색/적색';
        return '알약';
    }

    private static nms(boxes: BoundingBox[], threshold: number): BoundingBox[] {
        if (boxes.length === 0) return [];
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
