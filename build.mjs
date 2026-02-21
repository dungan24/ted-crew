import { build, context } from "esbuild";

const isWatch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: "dist/server.cjs",
  external: [],
  minify: false,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
};

if (isWatch) {
  const ctx = await context(options);
  await ctx.watch();
  console.error("[ted-crew] Watching for changes...");
} else {
  await build(options);
  console.error("[ted-crew] Build complete → dist/server.cjs");
}
