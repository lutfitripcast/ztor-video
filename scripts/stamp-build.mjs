// Runs before `wrangler deploy` (see package.json): stamps the build id into the Worker and the app page, so an open tab
// can notice a newer deployment and reload itself instead of running stale code for days.
import { readFileSync, writeFileSync } from "node:fs";
const build = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");   // e.g. 20261009-061500
writeFileSync(new URL("../src/build.ts", import.meta.url), `export const BUILD = "${build}";\n`);
const p = new URL("../public/app.html", import.meta.url);
writeFileSync(p, readFileSync(p, "utf8").replace(/const BUILD = '[^']*'/, `const BUILD = '${build}'`));
console.log("build", build);
