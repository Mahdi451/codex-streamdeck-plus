import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(root, "docs");
const markdownFiles = [
	path.join(root, "README.md"),
	...fs.readdirSync(docsDir)
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((name) => path.join(docsDir, name)),
];

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
	value: dom.window.navigator,
	configurable: true,
});
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.SVGElement = dom.window.SVGElement;

const { default: mermaid } = await import("mermaid");
mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

let diagramCount = 0;
let svgCount = 0;
const failures = [];

for (const filename of markdownFiles) {
	const source = fs.readFileSync(filename, "utf8");
	const relativeName = path.relative(root, filename);

	for (const [index, match] of [...source.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].entries()) {
		diagramCount += 1;
		try {
			await mermaid.parse(match[1]);
		} catch (error) {
			failures.push(`${relativeName}: Mermaid diagram ${index + 1}: ${error instanceof Error ? error.message : error}`);
		}
	}

	for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
		const rawTarget = match[1].trim().split(/\s+/)[0];
		if (!rawTarget || /^(?:https?:|mailto:|data:|#)/i.test(rawTarget)) continue;
		const target = decodeURIComponent(rawTarget.split("#", 1)[0]);
		const resolved = path.resolve(path.dirname(filename), target);
		if (!fs.existsSync(resolved)) failures.push(`${relativeName}: missing local link target ${rawTarget}`);
	}
}

for (const svgName of fs.readdirSync(path.join(docsDir, "assets")).filter((name) => name.endsWith(".svg"))) {
	svgCount += 1;
	const filename = path.join(docsDir, "assets", svgName);
	const parsed = new dom.window.DOMParser().parseFromString(fs.readFileSync(filename, "utf8"), "image/svg+xml");
	const parserError = parsed.querySelector("parsererror");
	if (parserError) failures.push(`${path.relative(root, filename)}: invalid SVG: ${parserError.textContent}`);
}

if (failures.length) {
	for (const failure of failures) console.error(`FAIL ${failure}`);
	process.exitCode = 1;
} else {
	console.log(`Validated ${markdownFiles.length} Markdown files, ${diagramCount} Mermaid diagrams, and ${svgCount} SVG visual.`);
}
