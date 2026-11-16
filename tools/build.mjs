// The bundles arrive with the build wiring step: the Experiment parent IIFE, the background bundle, then dist/desertbird.xpi.
// Until they exist this is a deliberate no-op, so `npm run build` stays green on a tree with no sources to bundle.
const ENTRY_POINTS = [];

if (ENTRY_POINTS.length === 0) {
    console.log("build: no entry points wired yet, nothing to bundle");
    process.exit(0);
}
