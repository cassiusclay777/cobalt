import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const moduleDir = join(process.cwd(), "node_modules", "@imput");
const targetDir = join(process.cwd(), "static", "_libav");

await mkdir(targetDir, { recursive: true });

const modules = await readdir(moduleDir);
const libavModules = modules.filter((name) => name.startsWith("libav.js"));

for (const moduleName of libavModules) {
    const distDir = join(moduleDir, moduleName, "dist");
    await cp(distDir, targetDir, { recursive: true });
}
