import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const generatorDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(generatorDir, "..");
const sourceDir = path.join(rootDir, "src");
const extensions = [".ts", ".tsx", ".js", ".jsx"];

function collectSourceFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory)) {
        const entryPath = path.join(directory, entry);
        const stat = statSync(entryPath);
        if (stat.isDirectory()) {
            if (entry === "__tests__") {
                continue;
            }
            files.push(...collectSourceFiles(entryPath));
        } else if (
            !entry.endsWith(".d.ts") &&
            extensions.includes(path.extname(entry))
        ) {
            files.push(entryPath);
        }
    }
    return files;
}

const sourceFiles = collectSourceFiles(sourceDir);
const sourceFileSet = new Set(sourceFiles.map(file => path.normalize(file)));

function resolveModule(fromFile, specifier) {
    let basePath;
    if (specifier.startsWith("@/")) {
        basePath = path.join(sourceDir, specifier.slice(2));
    } else if (specifier.startsWith(".")) {
        basePath = path.resolve(path.dirname(fromFile), specifier);
    } else {
        return null;
    }

    const candidates = [
        basePath,
        ...extensions.map(extension => `${basePath}${extension}`),
        ...extensions.map(extension => path.join(basePath, `index${extension}`)),
    ];
    return candidates
        .map(candidate => path.normalize(candidate))
        .find(candidate => sourceFileSet.has(candidate)) ?? null;
}

function collectRuntimeSpecifiers(file) {
    const source = readFileSync(file, "utf8");
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
        },
        fileName: file,
        reportDiagnostics: false,
    }).outputText;
    const ast = ts.createSourceFile(
        file,
        transpiled,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.JS,
    );
    const specifiers = [];

    function visit(node) {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            specifiers.push(node.moduleSpecifier.text);
        } else if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "require" &&
            node.arguments.length === 1 &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            specifiers.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    }

    visit(ast);
    return specifiers;
}

const graph = new Map(
    sourceFiles.map(file => [
        path.normalize(file),
        collectRuntimeSpecifiers(file)
            .map(specifier => resolveModule(file, specifier))
            .filter(Boolean),
    ]),
);

let nextIndex = 0;
const indices = new Map();
const lowLinks = new Map();
const stack = [];
const onStack = new Set();
const components = [];

function visitNode(node) {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex++;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
        if (!indices.has(dependency)) {
            visitNode(dependency);
            lowLinks.set(
                node,
                Math.min(lowLinks.get(node), lowLinks.get(dependency)),
            );
        } else if (onStack.has(dependency)) {
            lowLinks.set(
                node,
                Math.min(lowLinks.get(node), indices.get(dependency)),
            );
        }
    }

    if (lowLinks.get(node) !== indices.get(node)) {
        return;
    }

    const component = [];
    let current;
    do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
    } while (current !== node);
    components.push(component);
}

for (const file of sourceFiles) {
    const normalizedFile = path.normalize(file);
    if (!indices.has(normalizedFile)) {
        visitNode(normalizedFile);
    }
}

const cycles = components.filter(component =>
    component.length > 1 ||
    (graph.get(component[0]) ?? []).includes(component[0]),
);

if (cycles.length > 0) {
    console.error("Runtime import cycle audit failed:");
    for (const component of cycles) {
        console.error(
            `- ${component
                .map(file => path.relative(rootDir, file))
                .sort()
                .join(" -> ")}`,
        );
    }
    process.exit(1);
}

console.log(
    `Runtime import cycle audit passed (${sourceFiles.length} source files).`,
);
