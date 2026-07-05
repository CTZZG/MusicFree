export function getLowerFileExtension(filePath: string) {
    const pathWithoutSuffix = filePath.split(/[?#]/)[0];
    const slashIndex = Math.max(
        pathWithoutSuffix.lastIndexOf("/"),
        pathWithoutSuffix.lastIndexOf("\\"),
    );
    const dotIndex = pathWithoutSuffix.lastIndexOf(".");
    return dotIndex > slashIndex
        ? pathWithoutSuffix.slice(dotIndex).toLowerCase()
        : "";
}
