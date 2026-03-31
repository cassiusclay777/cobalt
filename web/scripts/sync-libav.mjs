import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const moduleDir = join(process.cwd(), "node_modules", "@imput");
const targetDir = join(process.cwd(), "static", "_libav");

await mkdir(targetDir, { recursive: true });

let modules = [];
try {
    modules = await readdir(moduleDir);
} catch (error) {
    // First-time setup or partial installs may not have @imput yet.
    console.warn(`[sync-libav] Skipping libav sync: missing directory "${moduleDir}".`);
    process.exit(0);
}

const libavModules = modules.filter((name) => name.startsWith("libav.js"));

for (const moduleName of libavModules) {
    const distDir = join(moduleDir, moduleName, "dist");
    try {
        await cp(distDir, targetDir, { recursive: true });
    } catch {
        // Ignore missing dist folders from optional or incomplete package installs.
    }
}
