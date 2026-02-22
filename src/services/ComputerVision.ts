import { QualityMetrics } from '../components/CameraView';

/**
 * ComputerVision Service encapsulates all OpenCV logic for the app.
 * STRICT RULE: All allocated cv.Mat objects MUST be immediately deleted 
 * before returning or throwing using `.delete()`.
 */
export class ComputerVision {
    /**
     * Evaluates the image quality for Blur and Glare.
     */
    static evaluateQualityGate(canvas: HTMLCanvasElement): QualityMetrics {
        // Protective check for OpenCV loading state
        if (!window.cv || !window.cv.Mat) {
            return { isStable: false, glareScore: 0, blurScore: 0, rejectionReason: 'CV not loaded' };
        }

        let src: any = null;
        let gray: any = null;
        let laplacian: any = null;

        try {
            // 1. Read image from canvas
            src = window.cv.imread(canvas);

            // Calculate Blur via Laplacian Variance
            gray = new window.cv.Mat();
            window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY);

            laplacian = new window.cv.Mat();
            window.cv.Laplacian(gray, laplacian, window.cv.CV_64F);

            const mean = new window.cv.Mat();
            const stddev = new window.cv.Mat();
            window.cv.meanStdDev(laplacian, mean, stddev);

            // Standard deviation squared is the variance
            const blurScore = stddev.doubleAt(0, 0) ** 2;

            // Calculate Glare (Percentage of pixels approaching pure white)
            // Very naive, fast approach: count pixels > brightness threshold
            let glarePixels = 0;
            const totalPixels = gray.rows * gray.cols;

            // Downsample for speed if needed, but since it's just pixel iteration in WASM, CV countNonZero is fast
            const thresholdMat = new window.cv.Mat();
            // Threshold at 250 (very bright)
            window.cv.threshold(gray, thresholdMat, 250, 255, window.cv.THRESH_BINARY);
            glarePixels = window.cv.countNonZero(thresholdMat);

            const glareScore = (glarePixels / totalPixels) * 100;

            // Cleanup mats utilized inside logic
            mean.delete();
            stddev.delete();
            thresholdMat.delete();

            // Define standard thresholds for PoC
            // Blur score < 100 usually means blurry. 
            // Glare > 2% of screen is usually a problem for plastic packets.
            const isBlurry = blurScore < 100;
            const isGlaring = glareScore > 2.0;

            let rejectionReason = undefined;
            if (isBlurry) rejectionReason = 'Image is blurry. Please hold steady/focus.';
            if (isGlaring) rejectionReason = 'Too much glare. Adjust lighting or angle.';

            return {
                isStable: (!isBlurry && !isGlaring),
                glareScore,
                blurScore,
                rejectionReason
            };

        } catch (err: any) {
            console.error("Quality gate CV error", err);
            return { isStable: false, glareScore: 0, blurScore: 0, rejectionReason: `CV Error: ${err.message}` };
        } finally {
            // MEMORY LEAK PREVENTION: always delete mats
            if (src) src.delete();
            if (gray) gray.delete();
            if (laplacian) laplacian.delete();
        }
    }

    /**
     * Dynamically locates the continuous rectangular block of pill bags using Edge Detection.
     * Returns the bounding rectangle with padding, or null if no appropriate block is found.
     */
    static findPillBagRegion(canvas: HTMLCanvasElement): { x: number, y: number, w: number, h: number } | null {
        if (!window.cv || !window.cv.Mat) return null;

        let src = null;
        let resized = null;
        let gray = null;
        let edges = null;
        let dilated = null;
        let contours = null;
        let hierarchy = null;

        try {
            src = window.cv.imread(canvas);

            // Resize to 640px wide for massive speedup and consistent morphological kernel sizes
            const scale = 640 / src.cols;
            resized = new window.cv.Mat();
            window.cv.resize(src, resized, new window.cv.Size(640, Math.round(src.rows * scale)));

            gray = new window.cv.Mat();
            window.cv.cvtColor(resized, gray, window.cv.COLOR_RGBA2GRAY);

            // Blur to remove tiny paper textures
            window.cv.GaussianBlur(gray, gray, new window.cv.Size(5, 5), 0);

            // Extract high-contrast borders (the text, the plastic edges, the colorful pills)
            edges = new window.cv.Mat();
            window.cv.Canny(gray, edges, 40, 120);

            // Heavily dilate to fuse the individual text/pills into a single solid rectangular blob
            dilated = new window.cv.Mat();
            const M = window.cv.getStructuringElement(window.cv.MORPH_RECT, new window.cv.Size(35, 35));
            window.cv.dilate(edges, dilated, M);
            M.delete();

            contours = new window.cv.MatVector();
            hierarchy = new window.cv.Mat();
            window.cv.findContours(dilated, contours, hierarchy, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);

            let maxArea = 0;
            let bestRect = null;
            const imgArea = resized.cols * resized.rows;

            for (let i = 0; i < contours.size(); ++i) {
                const cnt = contours.get(i);
                const area = window.cv.contourArea(cnt);
                const rect = window.cv.boundingRect(cnt);

                // Pill bags layout is horizontal. Require minimum 5% screen area and wide aspect ratio.
                const aspect = rect.width / rect.height;
                if (area > maxArea && area > (imgArea * 0.05) && aspect > 1.2) {
                    maxArea = area;
                    bestRect = rect;
                }
            }

            if (bestRect) {
                // Map back to the original HD coordinate space
                const ox = bestRect.x / scale;
                const oy = bestRect.y / scale;
                const ow = bestRect.width / scale;
                const oh = bestRect.height / scale;

                // Pad generously (8% horizontal, 15% vertical) to ensure no outer pills are sliced off
                const padX = ow * 0.08;
                const padY = oh * 0.15;

                const finalX = Math.max(0, ox - padX);
                const finalY = Math.max(0, oy - padY);
                const finalW = Math.min(canvas.width - finalX, ow + padX * 2);
                const finalH = Math.min(canvas.height - finalY, oh + padY * 2);

                return { x: finalX, y: finalY, w: finalW, h: finalH };
            }

        } catch (err) {
            console.error("ROI detection CV math failed", err);
        } finally {
            if (src) src.delete();
            if (resized) resized.delete();
            if (gray) gray.delete();
            if (edges) edges.delete();
            if (dilated) dilated.delete();
            if (contours) contours.delete();
            if (hierarchy) hierarchy.delete();
        }
        return null;
    }

    /**
     * Applies a 4-point homography transform to warp the packet region into a standard flat 10-grid top-down view.
     * `points` must be an array of exactly 4 {x, y} coordinate objects: [TL, TR, BR, BL]
     */
    static warpPerspective(sourceCanvas: HTMLCanvasElement, points: { x: number, y: number }[]): HTMLCanvasElement | null {
        if (!window.cv || points.length !== 4) return null;

        let src: any = null;
        let dst: any = null;
        let srcTri: any = null;
        let dstTri: any = null;
        let transformBase: any = null;

        // PoC standard coordinate space for the resulting warped mat.
        const targetWidth = 3000;
        const targetHeight = 750; // Aspect ratio of a 10-pill row ~ 4:1

        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = targetWidth;
        resultCanvas.height = targetHeight;

        try {
            src = window.cv.imread(sourceCanvas);
            dst = new window.cv.Mat();

            // Map 4 corner points
            const srcCoords = [
                points[0].x, points[0].y,
                points[1].x, points[1].y,
                points[2].x, points[2].y,
                points[3].x, points[3].y
            ];
            srcTri = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, srcCoords);

            // Map 4 target coordinates (corners of our target dimensions)
            const dstCoords = [
                0, 0,
                targetWidth, 0,
                targetWidth, targetHeight,
                0, targetHeight
            ];
            dstTri = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, dstCoords);

            // Generate the perspective transformation matrix
            transformBase = window.cv.getPerspectiveTransform(srcTri, dstTri);

            // Output target size structure
            const dsize = new window.cv.Size(targetWidth, targetHeight);

            // Perform Warp
            window.cv.warpPerspective(src, dst, transformBase, dsize, window.cv.INTER_LINEAR, window.cv.BORDER_CONSTANT, new window.cv.Scalar());

            // Draw the resulted mat to the target canvas to pass down the pipe
            window.cv.imshow(resultCanvas, dst);

            return resultCanvas;

        } catch (err: any) {
            console.error("Warp perspective error", err);
            return null;
        } finally {
            // CLEANUP
            if (src) src.delete();
            if (dst) dst.delete();
            if (srcTri) srcTri.delete();
            if (dstTri) dstTri.delete();
            if (transformBase) transformBase.delete();
        }
    }
}
