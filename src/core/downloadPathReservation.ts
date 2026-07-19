import path from "path-browserify";

interface IDownloadPathReservationOptions {
    resolvePath(fileName: string): string;
    exists(filePath: string): Promise<boolean>;
    createId: () => string;
}

/**
 * Serializes the filesystem check and in-memory reservation as one critical
 * section. Without this, two concurrent downloads can both observe the same
 * path as available while `exists()` is in flight.
 */
export default class DownloadPathReservation {
    private readonly reservedPaths = new Set<string>();
    private operationTail: Promise<void> = Promise.resolve();
    private readonly resolvePath: (fileName: string) => string;
    private readonly pathExists: (filePath: string) => Promise<boolean>;
    private readonly createId: () => string;

    constructor(options: IDownloadPathReservationOptions) {
        this.resolvePath = options.resolvePath;
        this.pathExists = options.exists;
        this.createId = options.createId;
    }

    reserve(fileName: string): Promise<string> {
        const operation = this.operationTail.then(() =>
            this.reserveUnlocked(fileName),
        );

        // A failed filesystem check must not poison later reservations.
        this.operationTail = operation.then(
            () => undefined,
            () => undefined,
        );
        return operation;
    }

    release(filePath: string) {
        this.reservedPaths.delete(filePath);
    }

    retain(filePath: string) {
        this.reservedPaths.add(filePath);
    }

    private async reserveUnlocked(fileName: string) {
        let candidate = this.resolvePath(fileName);
        if (
            !this.reservedPaths.has(candidate) &&
            !(await this.pathExists(candidate))
        ) {
            this.reservedPaths.add(candidate);
            return candidate;
        }

        const extension = path.extname(fileName);
        const basename = extension
            ? fileName.slice(0, -extension.length)
            : fileName;
        for (let index = 1; index < 1000; index += 1) {
            candidate = this.resolvePath(
                `${basename} (${index})${extension}`,
            );
            if (
                !this.reservedPaths.has(candidate) &&
                !(await this.pathExists(candidate))
            ) {
                this.reservedPaths.add(candidate);
                return candidate;
            }
        }

        candidate = this.resolvePath(
            `${basename}-${this.createId()}${extension}`,
        );
        this.reservedPaths.add(candidate);
        return candidate;
    }
}
