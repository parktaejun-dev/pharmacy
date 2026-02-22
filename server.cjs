const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8080;

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    
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
app.use((req, res) => {
    if (req.url.match(/\.(wasm|js|css|json|onnx|png|jpg)$/)) {
        res.status(404).send('Not Found: ' + req.url);
    } else {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
});

const options = {
    key: fs.readFileSync('server.key'),
    cert: fs.readFileSync('server.cert')
};

https.createServer(options, app).listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Express server running on https://0.0.0.0:${PORT}`);
});
