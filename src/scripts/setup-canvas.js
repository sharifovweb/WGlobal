const fs = require('fs');
fs.mkdirSync('node_modules/canvas', { recursive: true });
fs.writeFileSync('node_modules/canvas/index.js', 'module.exports = require("@napi-rs/canvas");');
fs.writeFileSync('node_modules/canvas/package.json', JSON.stringify({ name: "canvas", version: "2.11.2", main: "index.js" }));
console.log('canvas shim created');