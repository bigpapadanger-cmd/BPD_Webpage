import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { build, transform } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "public");
const output = resolve(root, ".wrangler/public-build");
const generatedRoot = resolve(root, ".wrangler");
// Remove only this generated checkout-local output, never source or caller paths.
if (!output.startsWith(generatedRoot + sep) || output === generatedRoot) throw new Error("Invalid generated output path");
await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
async function files(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
        if (entry.isSymbolicLink()) throw new Error("Build input must not contain symlinks");
        const path = resolve(directory, entry.name);
        result.push(...(entry.isDirectory() ? await files(path) : [path]));
    }
    return result;
}
const metrics = { javascript: { files: 0, sourceBytes: 0, outputBytes: 0 }, css: { files: 0, sourceBytes: 0, outputBytes: 0 }, masterCss: [] };
for (const path of await files(source)) {
    const extension = extname(path);
    if (![".js", ".css"].includes(extension)) continue;
    const text = await readFile(path, "utf8");
    const loader = extension === ".js" ? "js" : "css";
    const result = await transform(text, { loader, minify: true, target: "es2022", sourcemap: false, legalComments: "none" });
    const group = loader === "js" ? metrics.javascript : metrics.css;
    group.files++; group.sourceBytes += Buffer.byteLength(text); group.outputBytes += Buffer.byteLength(result.code);
    await writeFile(resolve(output, relative(source, path)), result.code);
}
// Flatten the existing callers' import chains without changing source ownership.
const callers = resolve(source, "Framework/Shell/CSS/Callers");
for (const name of await readdir(callers)) {
    if (!/^master(?:_[a-z]+)?\.css$/.test(name)) continue;
    const entry = resolve(callers, name);
    const destination = resolve(output, relative(source, entry));
    const result = await build({ entryPoints: [entry], outfile: destination, bundle: true, minify: true, write: false, metafile: true, sourcemap: false, legalComments: "none",
        plugins: [{ name: "public-css-paths", setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => {
                if (args.kind === "entry-point") return;
                if (/^(?:https?:|data:|#)/.test(args.path)) return { path: args.path, external: true };
                if (args.kind === "url-token") {
                    const path = args.path.startsWith("/") ? args.path : "/" + relative(source, resolve(args.resolveDir, args.path)).split(sep).join("/");
                    if (path.startsWith("/../")) throw new Error("CSS asset escapes public root");
                    return { path, external: true };
                }
                if (args.path.startsWith("/")) return { path: resolve(source, "." + args.path) };
            });
        } }] });
    const bytes = result.outputFiles[0].contents;
    await writeFile(destination, bytes);
    metrics.masterCss.push({ path: relative(source, entry).split(sep).join("/"), inputFiles: Object.keys(result.metafile.inputs).length, inputBytes: Object.values(result.metafile.inputs).reduce((sum, input) => sum + input.bytes, 0), outputBytes: bytes.byteLength });
}
metrics.css.minifiedSourceBytes = metrics.css.outputBytes;
metrics.css.outputBytes = 0;
for (const path of await files(output)) if (extname(path) === ".css") metrics.css.outputBytes += (await readFile(path)).byteLength;
await writeFile(resolve(root, ".wrangler/public-build-report.json"), JSON.stringify(metrics, null, 2) + "\n");
console.log(JSON.stringify(metrics));
