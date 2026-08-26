import type { IBasicMeta } from "@/native/mp3Util";
import type { LocalMusicScanFilterReason } from "./localMusicScanPolicy";

export interface ILocalMusicScanCandidate {
    musicPath: string;
    displayName?: string | null;
    size?: number | null;
    modifiedAt?: number | null;
}

export type LocalMusicScanStage =
    | "discovering"
    | "filtering"
    | "reading-metadata"
    | "merging"
    | "complete";

export interface ILocalMusicScanProgress {
    stage: LocalMusicScanStage;
    completed: number;
    total: number;
    cachedMetadataCount: number;
    metadataWarningCount: number;
}

export type LocalMusicScanProgressListener = (
    progress: ILocalMusicScanProgress,
) => void;

export interface ILocalMusicFilteredItem {
    candidate: ILocalMusicScanCandidate;
    reason: LocalMusicScanFilterReason;
}

export interface ILocalMusicMetadataIssue {
    candidate: ILocalMusicScanCandidate;
    message: string;
}

export interface ILocalMusicScanTimings {
    discoveryMs: number;
    metadataMs: number;
    mergeMs: number;
    totalMs: number;
}

export interface ILocalMusicImportReport {
    scannedCount: number;
    filteredCount: number;
    filteredByFileSizeCount: number;
    filteredByDurationCount: number;
    filteredLikelySystemSoundCount: number;
    addedCount: number;
    exactMatchedCount: number;
    weakMatchedCount: number;
    metadataEnrichedCount: number;
    cachedMetadataCount: number;
    metadataReadCount: number;
    metadataWarningCount: number;
    filteredItems: ILocalMusicFilteredItem[];
    metadataIssues: ILocalMusicMetadataIssue[];
    timings: ILocalMusicScanTimings;
}

export interface ILocalMusicMetadataReadResult {
    metadata: Array<IBasicMeta | null>;
    issues: ILocalMusicMetadataIssue[];
    cachedCount: number;
    readCount: number;
}
