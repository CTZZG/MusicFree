import type { Plugin } from "@/core/pluginManager";
import type { PluginDiagnosticEvent } from "@/core/pluginManager/diagnostics";
import type { IPluginSettingTranslate } from "./capabilityUtils";

interface IBuildPluginHealthCheckReportParams {
    plugin: Plugin;
    enabled: boolean;
    sourceLabel: string;
    sourceKnown: boolean;
    capabilityLabels: string[];
    userVariables: Record<string, string>;
    diagnostics: PluginDiagnosticEvent[];
    t: IPluginSettingTranslate;
}

function formatSingleLine(value: unknown, maxLength = 160) {
    const text = String(value ?? "-").replace(/\s+/g, " ").trim();
    if (!text) {
        return "-";
    }
    return text.length > maxLength
        ? `${text.slice(0, maxLength)}...`
        : text;
}

function formatList(items: string[], fallback: string) {
    return items.length ? items.join(", ") : fallback;
}

function getUserVariableLabel(variable: IPlugin.IUserVariable) {
    return variable.name
        ? `${variable.name} (${variable.key})`
        : variable.key;
}

function getConfiguredUserVariableCount(
    declaredVariables: IPlugin.IUserVariable[],
    userVariables: Record<string, string>,
) {
    return declaredVariables.filter(variable =>
        String(userVariables[variable.key] ?? "").trim(),
    ).length;
}

function getMissingUserVariableLabels(
    declaredVariables: IPlugin.IUserVariable[],
    userVariables: Record<string, string>,
) {
    return declaredVariables
        .filter(variable => !String(userVariables[variable.key] ?? "").trim())
        .map(getUserVariableLabel);
}

export function buildPluginHealthCheckReport(
    params: IBuildPluginHealthCheckReportParams,
) {
    const {
        plugin,
        enabled,
        sourceLabel,
        sourceKnown,
        capabilityLabels,
        userVariables,
        diagnostics,
        t,
    } = params;
    const declaredVariables = Array.isArray(plugin.instance.userVariables)
        ? plugin.instance.userVariables
        : [];
    const configuredVariableCount = getConfiguredUserVariableCount(
        declaredVariables,
        userVariables,
    );
    const missingVariableLabels = getMissingUserVariableLabels(
        declaredVariables,
        userVariables,
    );
    const attentionLines: string[] = [];

    if (!enabled) {
        attentionLines.push(t("pluginSetting.healthCheck.attentionDisabled"));
    }
    if (!sourceKnown) {
        attentionLines.push(t("pluginSetting.healthCheck.attentionUnknownSource"));
    }
    if (!capabilityLabels.length) {
        attentionLines.push(t("pluginSetting.healthCheck.attentionNoCapabilities"));
    }
    if (missingVariableLabels.length) {
        attentionLines.push(t("pluginSetting.healthCheck.attentionMissingVariables", {
            names: missingVariableLabels.join(", "),
        }));
    }
    if (diagnostics.length) {
        attentionLines.push(t("pluginSetting.healthCheck.attentionRecentDiagnostics", {
            count: diagnostics.length,
        }));
    }

    const title = t("pluginSetting.healthCheck.title", {
        name: plugin.name,
    });
    const userVariableSummary = declaredVariables.length
        ? t("pluginSetting.healthCheck.userVariablesSummary", {
            configured: configuredVariableCount,
            total: declaredVariables.length,
        })
        : t("pluginSetting.healthCheck.userVariablesNone");
    const diagnosticLines = diagnostics.length
        ? diagnostics.map(event => [
            `- ${new Date(event.createdAt).toLocaleString()} ${formatSingleLine(event.method)}`,
            `  ${formatSingleLine(event.message)}`,
        ].join("\n"))
        : [`- ${t("pluginSetting.healthCheck.noRecentDiagnostics")}`];

    const content = [
        `${t("pluginSetting.healthCheck.generatedAt")}: ${new Date().toLocaleString()}`,
        `${t("pluginSetting.pluginItem.detail.version")}: ${formatSingleLine(plugin.instance.version)}`,
        `${t("pluginSetting.pluginItem.detail.author")}: ${formatSingleLine(plugin.instance.author)}`,
        `${t("pluginSetting.pluginItem.detail.hash")}: ${formatSingleLine(plugin.hash ? plugin.hash.slice(0, 12) : "")}`,
        `${t("pluginSetting.healthCheck.status")}: ${enabled
            ? t("pluginSetting.healthCheck.enabled")
            : t("pluginSetting.healthCheck.disabled")}`,
        `${t("pluginSetting.healthCheck.source")}: ${sourceLabel}`,
        `${t("pluginSetting.healthCheck.capabilities")}: ${formatList(
            capabilityLabels,
            t("pluginSetting.healthCheck.noCapabilities"),
        )}`,
        `${t("pluginSetting.healthCheck.userVariables")}: ${userVariableSummary}`,
        missingVariableLabels.length
            ? `${t("pluginSetting.healthCheck.userVariablesMissing")}: ${missingVariableLabels.join(", ")}`
            : "",
        "",
        `${t("pluginSetting.healthCheck.attention")}:`,
        ...(attentionLines.length
            ? attentionLines.map(line => `- ${line}`)
            : [`- ${t("pluginSetting.healthCheck.attentionNone")}`]),
        "",
        `${t("pluginSetting.healthCheck.recentDiagnostics")}:`,
        ...diagnosticLines,
    ].filter(line => line !== "").join("\n");

    return {
        title,
        content,
        reportText: [title, "", content].join("\n"),
    };
}
