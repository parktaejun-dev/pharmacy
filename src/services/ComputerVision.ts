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
