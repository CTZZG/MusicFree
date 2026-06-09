/** 备份与恢复 */
/** 歌单、插件 */
import { compare } from "compare-versions";
import PluginManager from "./pluginManager";
import MusicSheet from "@/core/musicSheet";
import { ResumeMode } from "@/constants/commonConst.ts";
import LocalMusicSheet from "@/core/localMusicSheet";

/**
 * 结果：一份大的json文件
 * {
 *     musicSheets: [],
 *     plugins: [],
 * }
 */

interface IBackJson {
    musicSheets?: IMusic.IMusicSheetItem[];
    localMusicSheet?: IMusic.IMusicItem[];
    starredMusicSheets?: IMusic.IMusicSheetItem[];
    plugins?: IBackupPluginItem[];
}

interface IBackupPluginItem {
    srcUrl?: string;
    version?: string;
}

export interface IBackupPreview {
    musicSheetCount: number;
    musicCount: number;
    localMusicCount: number;
    starredMusicSheetCount: number;
    pluginCount: number;
    invalidPluginCount: number;
}

export interface IBackupResumeSectionReport {
    successCount: number;
    skippedCount: number;
    failedCount: number;
    failureReasons: string[];
}

export interface IBackupResumeReport {
    preview: IBackupPreview;
    musicSheets: IBackupResumeSectionReport;
    localMusicSheet: IBackupResumeSectionReport;
    starredMusicSheets: IBackupResumeSectionReport;
    plugins: IBackupResumeSectionReport;
}

function isValidPluginBackupItem(
    plugin: Partial<IBackupPluginItem> | null | undefined,
): plugin is IBackupPluginItem & { srcUrl: string } {
    return typeof plugin?.srcUrl === "string" && plugin.srcUrl.length > 0;
}

function isBackupObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object";
}

function normalizeArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
}

function parseBackup(raw: string | object): IBackJson {
    if (typeof raw === "string") {
        return JSON.parse(raw);
    }
    return raw as IBackJson;
}

function createSectionReport(
    successCount = 0,
    skippedCount = 0,
): IBackupResumeSectionReport {
    return {
        successCount,
        skippedCount,
        failedCount: 0,
        failureReasons: [],
    };
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function getMusicCountFromSheets(sheets: unknown) {
    return normalizeArray<Partial<IMusic.IMusicSheetItem>>(sheets)
        .reduce((sum, sheet) => (
            sum + (Array.isArray(sheet?.musicList) ? sheet.musicList.length : 0)
        ), 0);
}

function getBackupPreview(obj: IBackJson): IBackupPreview {
    const plugins = normalizeArray<IBackupPluginItem>(obj?.plugins);
    const validPluginCount = plugins.filter(isValidPluginBackupItem).length;

    return {
        musicSheetCount: normalizeArray(obj?.musicSheets).length,
        musicCount: getMusicCountFromSheets(obj?.musicSheets),
        localMusicCount: normalizeArray(obj?.localMusicSheet).length,
        starredMusicSheetCount: normalizeArray(obj?.starredMusicSheets).length,
        pluginCount: validPluginCount,
        invalidPluginCount: plugins.length - validPluginCount,
    };
}

async function resumePlugins(
    plugins: IBackupPluginItem[] | undefined,
): Promise<IBackupResumeSectionReport> {
    const report = createSectionReport();
    const pluginItems = normalizeArray<IBackupPluginItem>(plugins);
    const validPlugins = PluginManager.getEnabledPlugins();

    for (let plugin of pluginItems) {
        if (!isValidPluginBackupItem(plugin)) {
            report.skippedCount += 1;
            continue;
        }

        try {
            const installedPlugin = validPlugins.find(
                validPlugin =>
                    validPlugin.instance.srcUrl === plugin.srcUrl &&
                    compare(
                        validPlugin.instance.version ?? "0.0.0",
                        plugin.version ?? "0.0.1",
                        ">=",
                    ),
            );
            if (installedPlugin) {
                report.skippedCount += 1;
                continue;
            }

            const result = await PluginManager.installPluginFromUrl(plugin.srcUrl);
            if (result.success) {
                report.successCount += 1;
            } else {
                report.failedCount += 1;
                report.failureReasons.push(
                    `${plugin.srcUrl}: ${result.message ?? "unknown error"}`,
                );
            }
        } catch (e) {
            report.failedCount += 1;
            report.failureReasons.push(
                `${plugin.srcUrl}: ${getErrorMessage(e)}`,
            );
        }
    }

    return report;
}

function backup() {
    const musicSheets = MusicSheet.backupSheets();
    const localMusicSheet = LocalMusicSheet.getMusicList();
    const starredMusicSheets = MusicSheet.getStarredSheets();
    const plugins = PluginManager.getEnabledPlugins();
    const normalizedPlugins = plugins
        .filter(
            _ =>
                typeof _.instance.srcUrl === "string" &&
                _.instance.srcUrl.length > 0,
        )
        .map(_ => ({
            srcUrl: _.instance.srcUrl,
            version: _.instance.version,
        }));

    return JSON.stringify({
        musicSheets: musicSheets,
        localMusicSheet: localMusicSheet,
        starredMusicSheets: starredMusicSheets,
        plugins: normalizedPlugins,
    });
}

function preview(raw: string | object) {
    return getBackupPreview(parseBackup(raw));
}

async function resume(
    raw: string | object,
    resumeMode: ResumeMode = ResumeMode.Append,
): Promise<IBackupResumeReport> {
    const obj = parseBackup(raw);
    const backupPreview = getBackupPreview(obj);
    const { plugins, musicSheets, localMusicSheet, starredMusicSheets } =
        obj ?? {};

    const validMusicSheets = normalizeArray<IMusic.IMusicSheetItem>(musicSheets)
        .filter(isBackupObject) as IMusic.IMusicSheetItem[];
    const validStarredMusicSheets =
        normalizeArray<IMusic.IMusicSheetItem>(starredMusicSheets)
            .filter(isBackupObject) as IMusic.IMusicSheetItem[];

    const report: IBackupResumeReport = {
        preview: backupPreview,
        musicSheets: createSectionReport(
            validMusicSheets.length,
            backupPreview.musicSheetCount - validMusicSheets.length,
        ),
        localMusicSheet: createSectionReport(),
        starredMusicSheets: createSectionReport(
            validStarredMusicSheets.length,
            backupPreview.starredMusicSheetCount - validStarredMusicSheets.length,
        ),
        plugins: createSectionReport(),
    };

    /** 恢复歌单 */
    try {
        await MusicSheet.resumeSheets(validMusicSheets, resumeMode);
    } catch (e) {
        report.musicSheets.failedCount += report.musicSheets.successCount;
        report.musicSheets.successCount = 0;
        report.musicSheets.failureReasons.push(getErrorMessage(e));
    }

    try {
        report.localMusicSheet =
            await LocalMusicSheet.resumeMusicList(localMusicSheet);
    } catch (e) {
        report.localMusicSheet = createSectionReport(
            0,
            0,
        );
        report.localMusicSheet.failedCount = backupPreview.localMusicCount;
        report.localMusicSheet.failureReasons.push(getErrorMessage(e));
    }

    try {
        await MusicSheet.resumeStarredMusicSheets(validStarredMusicSheets);
    } catch (e) {
        report.starredMusicSheets.failedCount +=
            report.starredMusicSheets.successCount;
        report.starredMusicSheets.successCount = 0;
        report.starredMusicSheets.failureReasons.push(getErrorMessage(e));
    }

    report.plugins = await resumePlugins(plugins);

    return report;
}

const Backup = {
    backup,
    preview,
    resume,
};
export default Backup;
