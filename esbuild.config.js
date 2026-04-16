// Bundlea extension y webview por separado
const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const baseOptions = {
  bundle: true,
  sourcemap: true,
  minify: false,
};

async function build() {
  // Bundle de la extension (Node/CJS, vscode es externo)
  const extensionCtx = await esbuild.context({
    ...baseOptions,
    entryPoints: ["src/extension/extension.ts"],
    outfile: "dist/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node18",
  });

  // Bundle del webview (browser/IIFE, sin dependencias externas)
  const webviewCtx = await esbuild.context({
    ...baseOptions,
    entryPoints: ["src/webview/index.tsx"],
    outfile: "dist/webview.js",
    format: "iife",
    platform: "browser",
    target: "es2022",
    conditions: ["style"],
    loader: { ".css": "css" },
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
