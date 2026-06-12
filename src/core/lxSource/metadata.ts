import { ILxSourceMetadata } from "./types";

const metadataKeys = ["name", "description", "version", "author", "homepage"] as const;

function readHeaderComment(script: string) {
    return script.match(/\/\*\*?([\s\S]*?)\*\//)?.[1] ?? script.slice(0, 2000);
}

export function parseLxSourceMetadata(script: string): ILxSourceMetadata {
    const header = readHeaderComment(script);
    const metadata: Partial<ILxSourceMetadata> = {};

    for (const key of metadataKeys) {
        const match = header.match(new RegExp(`@${key}\\s+([^\\r\\n]+)`));
        if (match?.[1]?.trim()) {
            metadata[key] = match[1].trim();
        }
    }

    if (!metadata.name) {
        throw new Error("LX custom source is missing @name");
    }

    return metadata as ILxSourceMetadata;
}
