import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const moduleDir = join(process.cwd(), "node_modules", "@imput");
const targetDir = join(process.cwd(), "static", "_libav");

const isMissingPathError = (error) =>
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";

let modules = [];
try {
    modules = await readdir(moduleDir);
} catch (error) {
    // First-time setup or partial installs may not have @imput yet.
    console.warn(`[sync-libav] Skipping libav sync: missing directory "${moduleDir}".`);
    process.exit(0);
}

const libavModules = modules.filter((name) => name.startsWith("libav.js"));

// Keep sync deterministic: remove stale files from previous runs.
await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });

for (const moduleName of libavModules) {
    const distDir = join(moduleDir, moduleName, "dist");
    try {
        await cp(distDir, targetDir, { recursive: true, force: true });
    } catch (error) {
        // Optional/incomplete installs may miss dist folders, ignore only those.
        if (isMissingPathError(error)) {
            continue;
        }
        throw error;
    }
}
