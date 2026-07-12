/** 备份与恢复 */
/** 歌单、插件 */
import { compare } from "compare-versions";
import PluginManager from "./pluginManager";
import MusicSheet from "@/core/musicSheet";
import { ResumeMode } from "@/constants/commonConst.ts";
import LocalMusicSheet from "@/core/localMusicSheet";
import { validateRemoteInstallUrl } from "@/utils/remoteInstallUrl";

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
    pluginBackupV2?: IPluginBackupV2;
}

interface IBackupPluginItem {
    srcUrl?: string;
    version?: string;
}

type PluginBackupSourceType = "network" | "local-file" | "unknown";

interface IPluginBackupV2InstalledItem {
    name?: string;
    hash?: string;
    version?: string;
    sourceType?: PluginBackupSourceType;
    srcUrl?: string;
}

interface IPluginBackupV2 {
    version: 2;
    installed?: IPluginBackupV2InstalledItem[];
    order?: Record<string, number>;
    disabled?: string[];
    alternativePlugins?: Record<string, string>;
    userVariables?: Record<string, Record<string, string>>;
}

export interface IBackupPreview {
    musicSheetCount: number;
    musicCount: number;
    localMusicCount: number;
    starredMusicSheetCount: number;
    pluginCount: number;
    invalidPluginCount: number;
    pluginConfigCount: number;
}

export interface IBackupResumeSectionReport {
    successCount: number;
    skippedCount: number;
    failedCount: number;
    failureReasons: string[];
}

export interface IBackupResumeReport {
    preview: IBackupPreview;
    resumeMode: ResumeMode;
    musicSheets: IBackupResumeSectionReport;
    localMusicSheet: IBackupResumeSectionReport;
    starredMusicSheets: IBackupResumeSectionReport;
    plugins: IBackupResumeSectionReport;
    pluginConfigs: IBackupResumeSectionReport;
    preRestoreBackup?: {
        success: boolean;
        path?: string;
        error?: string;
    };
}

function isValidPluginBackupItem(
    plugin: Partial<IBackupPluginItem> | null | undefined,
): plugin is IBackupPluginItem & { srcUrl: string } {
    return typeof plugin?.srcUrl === "string" && plugin.srcUrl.length > 0;
}

function isBackupObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object";
}

function isValidPluginBackupV2InstalledItem(
    plugin: Partial<IPluginBackupV2InstalledItem> | null | undefined,
): plugin is IPluginBackupV2InstalledItem & { name: string } {
    return typeof plugin?.name === "string" && plugin.name.length > 0;
}

function normalizeArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
}

function normalizeStringArray(value: unknown): string[] {
    return normalizeArray<unknown>(value)
        .filter((item): item is string =>
            typeof item === "string" && item.length > 0,
        );
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
    if (!isBackupObject(value)) {
        return {};
    }
    return Object.entries(value).reduce<Record<string, number>>(
        (record, [key, val]) => {
            const numericValue = Number(val);
            if (key && Number.isFinite(numericValue)) {
                record[key] = numericValue;
            }
            return record;
        },
        {},
    );
}

function normalizeStringRecord(value: unknown): Record<string, string> {
    if (!isBackupObject(value)) {
        return {};
    }
    return Object.entries(value).reduce<Record<string, string>>(
        (record, [key, val]) => {
            if (key && typeof val === "string" && val.length > 0) {
                record[key] = val;
            }
            return record;
        },
        {},
    );
}

function normalizeUserVariableBackup(
    value: unknown,
): Record<string, Record<string, string>> {
    if (!isBackupObject(value)) {
        return {};
    }
    return Object.entries(value).reduce<Record<string, Record<string, string>>>(
        (record, [pluginName, variables]) => {
            const normalizedVariables = normalizeStringRecord(variables);
            if (pluginName && Object.keys(normalizedVariables).length) {
                record[pluginName] = normalizedVariables;
            }
            return record;
        },
        {},
    );
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

function getPluginBackupV2ConfigNames(pluginBackupV2?: IPluginBackupV2) {
    const names = new Set<string>();
    Object.keys(normalizeNumberRecord(pluginBackupV2?.order))
        .forEach(name => names.add(name));
    normalizeStringArray(pluginBackupV2?.disabled)
        .forEach(name => names.add(name));
    Object.keys(normalizeStringRecord(pluginBackupV2?.alternativePlugins))
        .forEach(name => names.add(name));
    Object.keys(normalizeUserVariableBackup(pluginBackupV2?.userVariables))
        .forEach(name => names.add(name));
    return names;
}

function getPluginPreview(obj: IBackJson) {
    if (obj?.pluginBackupV2?.version === 2) {
        const installed = normalizeArray<IPluginBackupV2InstalledItem>(
            obj.pluginBackupV2.installed,
        );
        const validPluginCount = installed
            .filter(isValidPluginBackupV2InstalledItem).length;
        return {
            pluginCount: validPluginCount,
            invalidPluginCount: installed.length - validPluginCount,
            pluginConfigCount:
                getPluginBackupV2ConfigNames(obj.pluginBackupV2).size,
        };
    }

    const plugins = normalizeArray<IBackupPluginItem>(obj?.plugins);
    const validPluginCount = plugins.filter(isValidPluginBackupItem).length;
    return {
        pluginCount: validPluginCount,
        invalidPluginCount: plugins.length - validPluginCount,
        pluginConfigCount: 0,
    };
}

function getBackupPreview(obj: IBackJson): IBackupPreview {
    const pluginPreview = getPluginPreview(obj);

    return {
        musicSheetCount: normalizeArray(obj?.musicSheets).length,
        musicCount: getMusicCountFromSheets(obj?.musicSheets),
        localMusicCount: normalizeArray(obj?.localMusicSheet).length,
        starredMusicSheetCount: normalizeArray(obj?.starredMusicSheets).length,
        pluginCount: pluginPreview.pluginCount,
        invalidPluginCount: pluginPreview.invalidPluginCount,
        pluginConfigCount: pluginPreview.pluginConfigCount,
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
            const validation = validateRemoteInstallUrl(plugin.srcUrl);
            if (!validation.ok) {
                report.failedCount += 1;
                report.failureReasons.push(
                    `${plugin.srcUrl}: ${validation.reason}`,
                );
                continue;
            }
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

function getPluginBackupSourceType(plugin: ReturnType<typeof PluginManager.getSortedPlugins>[number]): PluginBackupSourceType {
    if (
        typeof plugin.instance.srcUrl === "string" &&
        plugin.instance.srcUrl.length > 0
    ) {
        return "network";
    }
    if (plugin.path) {
        return "local-file";
    }
    return "unknown";
}

function createPluginBackupV2(): IPluginBackupV2 {
    const sortedPlugins = PluginManager.getSortedPlugins();
    const order: Record<string, number> = {};
    const disabled: string[] = [];
    const alternativePlugins: Record<string, string> = {};
    const userVariables: Record<string, Record<string, string>> = {};

    sortedPlugins.forEach((plugin, index) => {
        order[plugin.name] = index;

        if (!PluginManager.isPluginEnabled(plugin)) {
            disabled.push(plugin.name);
        }

        const alternativePluginName =
            PluginManager.getAlternativePluginName(plugin);
        if (alternativePluginName) {
            alternativePlugins[plugin.name] = alternativePluginName;
        }

        const variables = PluginManager.getUserVariables(plugin);
        if (Object.keys(variables).length) {
            userVariables[plugin.name] = variables;
        }
    });

    return {
        version: 2,
        installed: sortedPlugins.map(plugin => ({
            name: plugin.name,
            hash: plugin.hash,
            version: plugin.instance.version,
            sourceType: getPluginBackupSourceType(plugin),
            srcUrl: plugin.instance.srcUrl,
        })),
        order,
        disabled,
        alternativePlugins,
        userVariables,
    };
}

function getInstalledPluginForBackupItem(
    item: IPluginBackupV2InstalledItem & { name: string },
) {
    const plugins = PluginManager.getSortedPlugins();
    return plugins.find(plugin =>
        (item.hash && plugin.hash === item.hash) ||
        plugin.name === item.name,
    );
}

function isInstalledPluginVersionEnough(
    plugin: ReturnType<typeof PluginManager.getSortedPlugins>[number],
    item: IPluginBackupV2InstalledItem,
) {
    if (!item.version) {
        return true;
    }
    try {
        return compare(
            plugin.instance.version ?? "0.0.0",
            item.version,
            ">=",
        );
    } catch {
        return true;
    }
}

async function resumePluginBackupV2Installed(
    pluginBackupV2: IPluginBackupV2 | undefined,
): Promise<IBackupResumeSectionReport> {
    const report = createSectionReport();
    const installed = normalizeArray<IPluginBackupV2InstalledItem>(
        pluginBackupV2?.installed,
    );

    for (const item of installed) {
        if (!isValidPluginBackupV2InstalledItem(item)) {
            report.skippedCount += 1;
            continue;
        }

        const installedPlugin = getInstalledPluginForBackupItem(item);
        if (
            installedPlugin &&
            isInstalledPluginVersionEnough(installedPlugin, item)
        ) {
            report.skippedCount += 1;
            continue;
        }

        if (item.sourceType === "network" && item.srcUrl) {
            try {
                const validation = validateRemoteInstallUrl(item.srcUrl);
                if (!validation.ok) {
                    report.failedCount += 1;
                    report.failureReasons.push(
                        `${item.name}: ${validation.reason}`,
                    );
                    continue;
                }
                const result = await PluginManager.installPluginFromUrl(
                    item.srcUrl,
                );
                if (result.success) {
                    report.successCount += 1;
                } else {
                    report.failedCount += 1;
                    report.failureReasons.push(
                        `${item.name}: ${result.message ?? "unknown error"}`,
                    );
                }
            } catch (e) {
                report.failedCount += 1;
                report.failureReasons.push(
                    `${item.name}: ${getErrorMessage(e)}`,
                );
            }
            continue;
        }

        report.skippedCount += 1;
        if (item.sourceType === "local-file") {
            report.failureReasons.push(
                `${item.name}: 本地插件需要重新选择文件安装`,
            );
        } else if (!item.srcUrl) {
            report.failureReasons.push(
                `${item.name}: 缺少插件下载地址，已跳过安装`,
            );
        }
    }

    return report;
}

function applyPluginBackupV2Config(
    pluginBackupV2: IPluginBackupV2 | undefined,
): IBackupResumeSectionReport {
    const report = createSectionReport();
    if (pluginBackupV2?.version !== 2) {
        return report;
    }

    const order = normalizeNumberRecord(pluginBackupV2.order);
    const disabled = new Set(normalizeStringArray(pluginBackupV2.disabled));
    const alternativePlugins = normalizeStringRecord(
        pluginBackupV2.alternativePlugins,
    );
    const userVariables = normalizeUserVariableBackup(
        pluginBackupV2.userVariables,
    );
    const configNames = getPluginBackupV2ConfigNames(pluginBackupV2);
    const backupInstalledNames = new Set(
        normalizeArray<IPluginBackupV2InstalledItem>(pluginBackupV2.installed)
            .filter(isValidPluginBackupV2InstalledItem)
            .map(plugin => plugin.name),
    );

    if (Object.keys(order).length) {
        const sortedPlugins = [...PluginManager.getSortedPlugins()].sort(
            (a, b) => (order[a.name] ?? Infinity) - (order[b.name] ?? Infinity),
        );
        PluginManager.setPluginOrder(sortedPlugins);
    }

    configNames.forEach(pluginName => {
        const plugin = PluginManager.getByName(pluginName);
        if (!plugin) {
            report.skippedCount += 1;
            report.failureReasons.push(
                `${pluginName}: 插件未安装，已跳过配置恢复`,
            );
            return;
        }

        try {
            if (backupInstalledNames.has(pluginName) || disabled.has(pluginName)) {
                PluginManager.setPluginEnabled(
                    plugin,
                    !disabled.has(pluginName),
                );
            }
            if (userVariables[pluginName]) {
                PluginManager.setUserVariables(plugin, userVariables[pluginName]);
            }
            if (alternativePlugins[pluginName]) {
                PluginManager.setAlternativePluginName(
                    plugin,
                    alternativePlugins[pluginName],
                );
            }
            report.successCount += 1;
        } catch (e) {
            report.failedCount += 1;
            report.failureReasons.push(
                `${pluginName}: ${getErrorMessage(e)}`,
            );
        }
    });

    return report;
}

function backup() {
    const musicSheets = MusicSheet.backupSheets();
    const localMusicSheet = LocalMusicSheet.getMusicList();
    const starredMusicSheets = MusicSheet.getStarredSheets();
    const plugins = PluginManager.getEnabledPlugins();
    const pluginBackupV2 = createPluginBackupV2();
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
        pluginBackupV2,
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
        resumeMode,
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
        pluginConfigs: createSectionReport(),
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

    if (obj?.pluginBackupV2?.version === 2) {
        report.plugins = await resumePluginBackupV2Installed(
            obj.pluginBackupV2,
        );
        report.pluginConfigs = applyPluginBackupV2Config(obj.pluginBackupV2);
    } else {
        report.plugins = await resumePlugins(plugins);
    }

    return report;
}

const Backup = {
    backup,
    preview,
    resume,
};
export default Backup;
