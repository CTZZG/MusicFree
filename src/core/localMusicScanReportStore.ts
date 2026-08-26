import { nanoid } from "nanoid";

import type { ILocalMusicImportReport } from "./localMusicScanTypes";

/**
 * 扫描报告里的 filteredItems / metadataIssues 可能包含成千上万条候选。
 * 直接塞进导航参数会让整份数组常驻导航栈，所以这里只在内存里保留最近几份，
 * 路由参数只传一个 id。结果页在挂载时取一次，之后即使被淘汰也不影响当前页面。
 */
const maxRetainedReports = 3;
const reports = new Map<string, ILocalMusicImportReport>();

export function saveLocalMusicScanReport(report: ILocalMusicImportReport) {
    const reportId = nanoid();
    reports.set(reportId, report);
    while (reports.size > maxRetainedReports) {
        const oldestKey = reports.keys().next().value;
        if (oldestKey === undefined) {
            break;
        }
        reports.delete(oldestKey);
    }
    return reportId;
}

export function getLocalMusicScanReport(reportId?: string | null) {
    return reportId ? reports.get(reportId) ?? null : null;
}

export function clearLocalMusicScanReports() {
    reports.clear();
}
