const ort = require('onnxruntime-node');
async function test() {
    console.log("Loading model...");
    try {
        const session = await ort.InferenceSession.create('./public/models/roboflow.onnx');
        console.log("Model loaded successfully.");
        console.log("Input names:", session.inputNames);
        console.log("Output names:", session.outputNames);
    } catch(e) {
        console.error("Error loading model:", e);
    }
}
test();
