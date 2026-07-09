// Build a fully self-contained single-file prototype: inline React + ReactDOM
// (production UMD) and precompile the JSX so index.html opens working with zero
// network dependency. Run: node build.mjs
import { readFileSync, writeFileSync } from 'fs';
import { transformSync } from '@babel/core';
import presetReact from '@babel/preset-react';

const react = readFileSync('node_modules/react/umd/react.production.min.js', 'utf8');
const reactDom = readFileSync('node_modules/react-dom/umd/react-dom.production.min.js', 'utf8');
const css = readFileSync('src/styles.css', 'utf8');
const jsx = readFileSync('src/app.jsx', 'utf8');

const { code } = transformSync(jsx, {
  presets: [[presetReact, { runtime: 'classic' }]],
  compact: false,
});

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rūya — Decision-Support Journey Prototype</title>
<!-- Fully self-contained: React + ReactDOM inlined, JSX precompiled. No network needed. -->
<style>
${css}</style>
</head>
<body>
<div id="root"></div>
<script>${react}</script>
<script>${reactDom}</script>
<script>
${code}
</script>
</body>
</html>
`;

writeFileSync('index.html', html);
console.log('Wrote index.html —', (html.length / 1024).toFixed(0), 'KB');
