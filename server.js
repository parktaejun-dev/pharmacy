const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8080;

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    
    // Explicitly set WASM MIME type just in case
    if (req.url.endsWith('.wasm')) {
        res.type('application/wasm');
    }
    if (req.url.endsWith('.onnx')) {
        res.type('application/octet-stream');
    }
    
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback
app.get('*', (req, res) => {
    // DO NOT send index.html for .wasm or .js files requests that 404, send a real 404
    if (req.url.match(/\.(wasm|js|css|json|onnx|png|jpg)$/)) {
        res.status(404).send('Not Found');
    } else {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
});

// We need a self-signed cert for https, generate one on the fly or use Vite's if available
const options = {};
try {
    options.key = fs.readFileSync(path.join(__dirname, 'node_modules', '.vite', 'basic-ssl', 'cert.key'));
    options.cert = fs.readFileSync(path.join(__dirname, 'node_modules', '.vite', 'basic-ssl', 'cert.crt'));
} catch (e) {
    console.error("Vite basic-ssl certs not found, please generate certs or run without https");
    process.exit(1);
}

https.createServer(options, app).listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Express server running on https://0.0.0.0:${PORT}`);
});
