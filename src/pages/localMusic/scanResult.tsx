import AppBar from "@/components/base/appBar";
import { Button } from "@/components/base/button";
import ListItem, { ListItemHeader } from "@/components/base/listItem";
import StatusBar from "@/components/base/statusBar";
import ThemeText from "@/components/base/themeText";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import globalStyle from "@/constants/globalStyle";
import { useI18N } from "@/core/i18n";
import { useParams } from "@/core/router";
import type {
    ILocalMusicImportReport,
    ILocalMusicScanCandidate,
} from "@/core/localMusicScanTypes";
import { getLocalMusicScanReport } from "@/core/localMusicScanReportStore";
import type { LocalMusicScanFilterReason } from "@/core/localMusicScanPolicy";
import { devLog } from "@/utils/log";
import rpx from "@/utils/rpx";
import { FlashList } from "@shopify/flash-list";
import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import useLocalMusicScanFlow, {
    importFilteredLocalMusic,
    retryLocalMusicMetadata,
} from "./scanFlow";

type ResultRow =
    | { type: "filtered"; key: string; candidate: ILocalMusicScanCandidate; reason: LocalMusicScanFilterReason }
    | { type: "warning"; key: string; candidate: ILocalMusicScanCandidate; message: string };

function getCandidateLabel(candidate: ILocalMusicScanCandidate) {
    return candidate.displayName?.trim() ||
        candidate.musicPath.split(/[\\/]/).pop() ||
        candidate.musicPath;
}

const emptyReport: ILocalMusicImportReport = {
    scannedCount: 0,
    filteredCount: 0,
    filteredByFileSizeCount: 0,
    filteredByDurationCount: 0,
    filteredLikelySystemSoundCount: 0,
    addedCount: 0,
    exactMatchedCount: 0,
    weakMatchedCount: 0,
    metadataEnrichedCount: 0,
    cachedMetadataCount: 0,
    metadataReadCount: 0,
    metadataWarningCount: 0,
    filteredItems: [],
    metadataIssues: [],
    timings: {
        discoveryMs: 0,
        metadataMs: 0,
        mergeMs: 0,
        totalMs: 0,
    },
};

export default function LocalMusicScanResult() {
    const { reportId } = useParams<"local-scan-result">();
    // 报告只在内存 store 里，挂载时取一次即可；后续被淘汰不影响当前页面。
    const [report] = useState(
        () => getLocalMusicScanReport(reportId) ?? emptyReport,
    );
    const { t } = useI18N();
    const runScan = useLocalMusicScanFlow();
    const repairedCount = report.exactMatchedCount + report.weakMatchedCount;
    const rows = useMemo<ResultRow[]>(() => [
        ...report.filteredItems.map((item, index) => ({
            type: "filtered" as const,
            key: `filtered-${item.candidate.musicPath}-${index}`,
            candidate: item.candidate,
            reason: item.reason,
        })),
        ...report.metadataIssues.map((issue, index) => ({
            type: "warning" as const,
            key: `warning-${issue.candidate.musicPath}-${index}`,
            candidate: issue.candidate,
            message: issue.message,
        })),
    ], [report.filteredItems, report.metadataIssues]);

    const filterReasonLabel = {
        "file-size": t("localMusic.scanResult.reason.fileSize"),
        duration: t("localMusic.scanResult.reason.duration"),
        "likely-system-sound": t(
            "localMusic.scanResult.reason.systemSound",
        ),
    } as const;

    const header = (
        <View>
            <ThemeText
                fontSize="title"
                fontWeight="bold"
                style={styles.summary}>
                {t("localMusic.scanResult.summary", {
                    scanned: report.scannedCount,
                    added: report.addedCount,
                    repaired: repairedCount,
                    filtered: report.filteredCount,
                    sizeFiltered: report.filteredByFileSizeCount,
                    durationFiltered: report.filteredByDurationCount,
                    systemFiltered: report.filteredLikelySystemSoundCount,
                })}
            </ThemeText>
            <ThemeText fontColor="textSecondary" style={styles.metrics}>
                {t("localMusic.scanResult.metrics", {
                    cached: report.cachedMetadataCount,
                    read: report.metadataReadCount,
                    warnings: report.metadataWarningCount,
                    enriched: report.metadataEnrichedCount,
                    time: report.timings.totalMs,
                })}
            </ThemeText>
            {report.filteredItems.length ? (
                <ListItemHeader>
                    {t("localMusic.scanResult.filtered", {
                        count: report.filteredItems.length,
                    })}
                </ListItemHeader>
            ) : report.metadataIssues.length ? (
                <ListItemHeader>
                    {t("localMusic.scanResult.warnings", {
                        count: report.metadataIssues.length,
                    })}
                </ListItemHeader>
            ) : null}
        </View>
    );

    const footer = (
        <View style={styles.footer}>
            {report.filteredItems.length ? (
                <Button
                    type="primary"
                    text={t("localMusic.scanResult.importFiltered")}
                    style={styles.action}
                    onPress={() => runScan(onProgress =>
                        importFilteredLocalMusic(report, onProgress),
                    )}
                />
            ) : null}
            {report.metadataIssues.length ? (
                <>
                    <ThemeText
                        fontColor="textSecondary"
                        style={styles.explanation}>
                        {t("localMusic.scanResult.warningExplanation")}
                    </ThemeText>
                    <Button
                        type="primary"
                        text={t("localMusic.scanResult.retryWarnings")}
                        style={styles.action}
                        onPress={() => runScan(onProgress =>
                            retryLocalMusicMetadata(report, onProgress),
                        )}
                    />
                </>
            ) : null}
            {!rows.length ? (
                <View style={styles.empty}>
                    <ThemeText fontColor="textSecondary">
                        {t("localMusic.scanResult.noIssues")}
                    </ThemeText>
                </View>
            ) : null}
        </View>
    );

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <StatusBar />
            <AppBar>{t("localMusic.scanResult.title")}</AppBar>
            <FlashList
                data={rows}
                keyExtractor={item => item.key}
                drawDistance={rpx(600)}
                ListHeaderComponent={header}
                ListFooterComponent={footer}
                onLoad={info => devLog(
                    "info",
                    "local-scan-result-first-render",
                    {
                        elapsedTimeInMs: info.elapsedTimeInMs,
                        rowCount: rows.length,
                    },
                )}
                renderItem={({ item, index }) => (
                    <>
                        {index === report.filteredItems.length &&
                        report.filteredItems.length > 0 &&
                        report.metadataIssues.length > 0 ? (
                                <ListItemHeader>
                                    {t("localMusic.scanResult.warnings", {
                                        count: report.metadataIssues.length,
                                    })}
                                </ListItemHeader>
                            ) : null}
                        <ListItem
                            withHorizontalPadding
                            heightType="big">
                            <ListItem.Content
                                title={getCandidateLabel(item.candidate)}
                                description={
                                    item.type === "filtered"
                                        ? filterReasonLabel[item.reason]
                                        : item.message
                                }
                            />
                        </ListItem>
                    </>
                )}
            />
        </VerticalSafeAreaView>
    );
}

const styles = StyleSheet.create({
    summary: {
        paddingHorizontal: rpx(24),
        paddingTop: rpx(28),
        lineHeight: rpx(40),
    },
    metrics: {
        paddingHorizontal: rpx(24),
        paddingTop: rpx(16),
        lineHeight: rpx(34),
    },
    footer: {
        paddingBottom: rpx(48),
    },
    explanation: {
        paddingHorizontal: rpx(24),
        paddingTop: rpx(24),
        lineHeight: rpx(34),
    },
    action: {
        marginHorizontal: rpx(24),
        marginTop: rpx(20),
    },
    empty: {
        padding: rpx(36),
        alignItems: "center",
    },
});
