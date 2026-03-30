"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");

fs.mkdirSync(distDir, { recursive: true });

for (const fileName of ["server.js", "kraken-loader.js"]) {
  fs.copyFileSync(
    path.join(projectRoot, "src", fileName),
    path.join(distDir, fileName)
  );
}

console.log("Copied runtime files into dist/");
