import type { IQmcStreamInfo } from "@/native/qmc";
import type { DownloadDecryptionDescriptor } from "./downloadFinalizationJournal";

export interface IDownloadMediaPlan {
    extension: string;
    cacheExtension: string;
    decryption?: DownloadDecryptionDescriptor;
}

interface IDownloadSourceEncryption {
    url?: string;
    ekey?: string;
    cek?: string;
}

export function selectDownloadSourceEncryption(input: {
    original: IDownloadSourceEncryption;
    resolved?: IDownloadSourceEncryption | null;
}): IDownloadSourceEncryption {
    const { original, resolved } = input;
    if (!resolved?.url) {
        return original;
    }
    const urlUnchanged = resolved.url === original.url;
    return {
        url: resolved.url,
        ekey: resolved.ekey ?? (urlUnchanged ? original.ekey : undefined),
        cek: resolved.cek ?? (urlUnchanged ? original.cek : undefined),
    };
}

export function assertQmcDecryptionOutput(
    expectedExtension: string,
    actual: IQmcStreamInfo,
) {
    const expected = expectedExtension.trim().replace(/^\./, "").toLowerCase();
    const actualExtension = actual.extension.trim().replace(/^\./, "").toLowerCase();
    if (!expected || actualExtension !== expected) {
        throw new Error(
            `QMC decrypted format mismatch: expected ${expected || "unknown"}, received ${actualExtension || "unknown"}`,
        );
    }
}

export function createDownloadMediaPlan(input: {
    sourceExtension: string;
    cencKey?: string;
    qmcInfo?: IQmcStreamInfo;
    qmcEkey?: string;
    supportedExtensions: readonly string[];
}): IDownloadMediaPlan {
    const sourceExtension = input.sourceExtension.trim().toLowerCase();
    const qmcExtension = input.qmcInfo?.extension.trim().toLowerCase();
    const isSupportedExtension = (extension: string) =>
        input.supportedExtensions.some(
            item => item.toLowerCase() === `.${extension}`,
        );
    if (
        input.qmcInfo &&
        (!qmcExtension || !isSupportedExtension(qmcExtension))
    ) {
        throw new Error("Unsupported decrypted QMC audio format");
    }
    const decryption: DownloadDecryptionDescriptor | undefined = input.cencKey
        ? { scheme: "cenc", key: input.cencKey }
        : input.qmcInfo
            ? {
                scheme: "qmc",
                ...(input.qmcEkey ? { ekey: input.qmcEkey } : {}),
                outputExtension: qmcExtension,
            }
            : undefined;
    let extension = input.cencKey
        ? "m4a"
        : qmcExtension || sourceExtension;
    if (
        !decryption &&
        !isSupportedExtension(extension)
    ) {
        extension = "mp3";
    }
    return {
        extension,
        cacheExtension: decryption?.scheme ?? extension,
        ...(decryption ? { decryption } : {}),
    };
}
