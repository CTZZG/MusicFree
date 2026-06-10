import { showDialog } from "@/components/dialogs/useDialog";
import Config from "@/core/appConfig";
import PluginManager from "@/core/pluginManager";
import Toast from "@/utils/toast";
import axios from "axios";
import {
    IInstallPluginFailureReason,
    IInstallPluginResult,
} from "@/types/core/pluginManager";
import type { ILanguageData } from "@/types/core/i18n";
import { recordPluginInstallFailure } from "@/core/pluginManager/diagnostics";

export type PluginInstallTranslate = <K extends keyof ILanguageData>(
    key: K,
    args?: Record<string, any>,
) => ILanguageData[K];

export type PluginSubscriptionUrlKind =
    | "single-plugin"
    | "collection"
    | "invalid";

interface IInstallPluginFromUrlTextOptions {
    requireSupportedExtension?: boolean;
}

const installFailureReasonI18nKeys: Record<
    IInstallPluginFailureReason,
    keyof ILanguageData
> = {
    "file-read": "pluginSetting.installResult.failureReason.file-read",
    network: "pluginSetting.installResult.failureReason.network",
    "not-found": "pluginSetting.installResult.failureReason.not-found",
    parse: "pluginSetting.installResult.failureReason.parse",
    "newer-version-installed":
        "pluginSetting.installResult.failureReason.newer-version-installed",
    unrecognized: "pluginSetting.installResult.failureReason.unrecognized",
    unknown: "pluginSetting.installResult.failureReason.unknown",
};

function getHttpStatus(error: any) {
    return (
        error?.response?.status ??
        error?.response?.statusCode ??
        error?.status ??
        error?.statusCode
    );
}

function getUrlPathForExtension(url: string) {
    return url.trim().split(/[?#]/)[0].toLowerCase();
}

function recordFailedInstallResult(result: IInstallPluginResult) {
    recordPluginInstallFailure(result);
    return result;
}

export function getPluginSubscriptionUrlKind(
    url: string,
): PluginSubscriptionUrlKind {
    const urlPath = getUrlPathForExtension(url);
    if (urlPath.endsWith(".json")) {
        return "collection";
    }
    if (urlPath.endsWith(".js")) {
        return "single-plugin";
    }
    return "invalid";
}

export function isPluginSubscriptionUrlSupported(url: string) {
    return getPluginSubscriptionUrlKind(url) !== "invalid";
}

export function getInstallResultSourceLabel(
    result: IInstallPluginResult,
    t: PluginInstallTranslate,
) {
    if (result.sourceType === "network") {
        return t("pluginSetting.pluginItem.source.network");
    }
    if (result.sourceType === "local-file") {
        return t("pluginSetting.pluginItem.source.localFile");
    }
    return t("pluginSetting.pluginItem.source.unknown");
}

function getInstallFailureReasonLabel(
    result: IInstallPluginResult,
    t: PluginInstallTranslate,
) {
    const reason = result.failureReason ?? "unknown";
    return t(
        installFailureReasonI18nKeys[reason] ??
            installFailureReasonI18nKeys.unknown,
    );
}

export function formatPluginInstallResult(
    result: IInstallPluginResult,
    t: PluginInstallTranslate,
) {
    const title =
        result.pluginName ??
        result.pluginUrl ??
        t("common.unknownName");
    const lines = [
        result.pluginVersion
            ? t("pluginSetting.pluginItem.versionHint", {
                version: result.pluginVersion,
            })
            : "",
        `${t("pluginSetting.installResult.source")}: ${getInstallResultSourceLabel(result, t)}`,
        result.pluginUrl ? `${result.pluginUrl}` : "",
        result.success
            ? ""
            : `${t("pluginSetting.installResult.failureType")}: ${getInstallFailureReasonLabel(result, t)}`,
        result.success
            ? ""
            : `${t("pluginSetting.installResult.retryable")}: ${
                result.retryable
                    ? t("pluginSetting.installResult.retryable.yes")
                    : t("pluginSetting.installResult.retryable.no")
            }`,
        result.success || !result.message
            ? ""
            : t("pluginSetting.failReason", {
                reason: result.message ?? "",
            }),
    ].filter(Boolean);

    return [title, ...lines].join("\n");
}

export function showPluginInstallResults(
    successResults: IInstallPluginResult[],
    failResults: IInstallPluginResult[],
    t: PluginInstallTranslate,
) {
    const content = [
        successResults.length
            ? `${t("pluginSetting.installResult.success")}\n${successResults.map(it => formatPluginInstallResult(it, t)).join("\n-----\n")}`
            : "",
        failResults.length
            ? `${t("pluginSetting.installResult.failed")}\n${failResults.map(it => formatPluginInstallResult(it, t)).join("\n-----\n")}`
            : "",
    ].filter(Boolean).join("\n\n");
    const showInstallResultDialog = () => {
        showDialog("SimpleDialog", {
            title: t("pluginSetting.installResult.dialogTitle"),
            content,
        });
    };

    if (!failResults.length) {
        Toast.success(t("toast.installPluginSuccess"), {
            actionText: t("common.view"),
            onActionClick: showInstallResultDialog,
        });
        return;
    }

    Toast.warn(
        successResults.length
            ? t("toast.partialPluginInstallFailed")
            : t("toast.allPluginInstallFailed"),
        {
            type: "warn",
            actionText: t("common.view"),
            onActionClick: showInstallResultDialog,
        },
    );
}

export async function installPluginFromUrlText(
    text: string,
    options?: IInstallPluginFromUrlTextOptions,
): Promise<IInstallPluginResult[]> {
    const inputUrl = text.trim();
    const urlKind = getPluginSubscriptionUrlKind(inputUrl);
    if (urlKind === "invalid" && options?.requireSupportedExtension) {
        return [recordFailedInstallResult({
            success: false,
            message: "订阅地址必须以 .js 或 .json 结尾",
            pluginUrl: text,
            sourceType: "network",
            failureReason: "unrecognized",
            retryable: false,
        })];
    }

    try {
        let urls: string[] = [];
        if (urlKind === "collection") {
            const jsonFile = (
                await axios.get(inputUrl, {
                    headers: {
                        "Cache-Control": "no-cache",
                        Pragma: "no-cache",
                        Expires: "0",
                    },
                })
            ).data;
            urls = (jsonFile?.plugins ?? [])
                .map((_: any) =>
                    typeof _?.url === "string" ? _.url.trim() : "",
                )
                .filter((url: string) => Boolean(url));
            if (!urls.length) {
                return [recordFailedInstallResult({
                    success: false,
                    message: "订阅无效",
                    pluginUrl: inputUrl,
                    sourceType: "network",
                    failureReason: "unrecognized",
                    retryable: false,
                })];
            }
        } else {
            urls = [inputUrl];
        }
        return await Promise.all(
            urls.map(url =>
                PluginManager.installPluginFromUrl(url, {
                    notCheckVersion: Config.getConfig(
                        "basic.notCheckPluginVersion",
                    ),
                }),
            ),
        );
    } catch (e: any) {
        const isNotFound = getHttpStatus(e) === 404;
        return [recordFailedInstallResult({
            success: false,
            message: isNotFound
                ? "插件不存在，请联系插件作者"
                : e?.message,
            pluginUrl: text,
            sourceType: "network",
            failureReason: isNotFound ? "not-found" : "network",
            retryable: !isNotFound,
        })];
    }
}
