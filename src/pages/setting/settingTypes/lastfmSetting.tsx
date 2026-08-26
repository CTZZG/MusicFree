import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";

import ListItem, { ListItemHeader } from "@/components/base/listItem";
import ThemeSwitch from "@/components/base/switch";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import LastfmScrobbler, { type LastfmStatus } from "@/core/lastfm";
import { errorLog } from "@/utils/log";
import Toast from "@/utils/toast";

export default function LastfmSetting() {
    const { t } = useI18N();
    const enabled = useAppConfig("lastfm.enabled");
    const nowPlaying = useAppConfig("lastfm.nowPlaying");
    const apiKey = useAppConfig("lastfm.apiKey");
    const [status, setStatus] = useState<LastfmStatus>({
        configured: false,
        authorized: false,
        username: null,
        pendingCount: 0,
    });
    /**
     * 浏览器授权拿到的一次性 token。Last.fm 的移动端授权没有自动回跳，只能
     * 「去浏览器点同意 → 回来点完成」两段式，中间这个 token 必须留在内存里。
     */
    const [pendingToken, setPendingToken] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const refreshStatus = useCallback(async () => {
        try {
            setStatus(await LastfmScrobbler.getStatus());
        } catch (e: any) {
            errorLog("读取 Last.fm 状态失败", e?.message ?? e);
        }
    }, []);

    useEffect(() => {
        refreshStatus();
    }, [refreshStatus, apiKey, enabled]);

    const onConfigureCredentials = () => {
        showPanel("SetUserVariables", {
            title: t("lastfm.credentials"),
            initValues: {
                apiKey: apiKey ?? "",
                apiSecret: "",
            },
            variables: [
                {
                    key: "apiKey",
                    name: "API Key",
                    hint: t("lastfm.credentialsHint"),
                },
                {
                    key: "apiSecret",
                    name: "API Secret",
                    hint: status.configured
                        ? t("lastfm.secretStoredHint")
                        : t("lastfm.secretMissingHint"),
                    secureTextEntry: true,
                },
            ],
            async onOk(values, closePanel) {
                const nextKey = (values.apiKey ?? "").trim();
                const nextSecret = (values.apiSecret ?? "").trim();
                if (!nextKey) {
                    Toast.warn(t("lastfm.apiKeyRequired"));
                    return;
                }
                try {
                    Config.setConfig("lastfm.apiKey", nextKey);
                    // secret 留空 = 保持已存的那份不动，和 WebDAV 密码同样的约定，
                    // 免得用户只想改 key 却被迫把 secret 重新抄一遍。
                    if (nextSecret) {
                        await LastfmScrobbler.setApiSecret(nextSecret);
                    }
                    await refreshStatus();
                    Toast.success(t("toast.saveSuccess"));
                    closePanel();
                } catch (e: any) {
                    Toast.warn(e?.message ?? t("lastfm.saveFailed"));
                }
            },
        });
    };

    const onBeginAuthorize = async () => {
        setBusy(true);
        try {
            const token = await LastfmScrobbler.beginAuthorization();
            setPendingToken(token);
            Toast.success(t("lastfm.authorizeOpened"));
        } catch (e: any) {
            Toast.warn(e?.message ?? t("lastfm.authorizeFailed"));
        } finally {
            setBusy(false);
        }
    };

    const onCompleteAuthorize = async () => {
        if (!pendingToken) {
            return;
        }
        setBusy(true);
        try {
            const username =
                await LastfmScrobbler.completeAuthorization(pendingToken);
            setPendingToken(null);
            await refreshStatus();
            Toast.success(
                t("lastfm.authorizeSuccess", { username: username || "" }),
            );
        } catch (e: any) {
            Toast.warn(e?.message ?? t("lastfm.authorizeFailed"));
        } finally {
            setBusy(false);
        }
    };

    const onSignOut = () => {
        showDialog("SimpleDialog", {
            title: t("lastfm.signOut"),
            content: t("lastfm.signOutConfirm"),
            async onOk() {
                await LastfmScrobbler.signOut();
                setPendingToken(null);
                await refreshStatus();
                Toast.success(t("lastfm.signOutDone"));
            },
        });
    };

    const onFlushNow = async () => {
        setBusy(true);
        try {
            await LastfmScrobbler.flush();
            await refreshStatus();
            Toast.success(t("lastfm.flushDone"));
        } catch (e: any) {
            Toast.warn(e?.message ?? t("lastfm.flushFailed"));
        } finally {
            setBusy(false);
        }
    };

    const onClearPending = () => {
        showDialog("SimpleDialog", {
            title: t("lastfm.clearPending"),
            content: t("lastfm.clearPendingConfirm"),
            async onOk() {
                LastfmScrobbler.clearPending();
                await refreshStatus();
            },
        });
    };

    const statusText = !status.configured
        ? t("lastfm.status.notConfigured")
        : status.authorized
            ? t("lastfm.status.authorized", {
                username: status.username ?? "",
            })
            : t("lastfm.status.notAuthorized");

    return (
        <ScrollView style={style.wrapper}>
            <ListItemHeader>{t("lastfm.account")}</ListItemHeader>

            <ListItem withHorizontalPadding>
                <ListItem.Content
                    title={t("lastfm.status")}
                    description={statusText}
                />
            </ListItem>

            <ListItem withHorizontalPadding onPress={onConfigureCredentials}>
                <ListItem.Content
                    title={t("lastfm.credentials")}
                    description={t("lastfm.credentialsDesc")}
                />
            </ListItem>

            {status.configured && !status.authorized ? (
                <ListItem
                    withHorizontalPadding
                    onPress={busy ? undefined : onBeginAuthorize}>
                    <ListItem.Content
                        title={t("lastfm.authorizeStep1")}
                        description={t("lastfm.authorizeStep1Desc")}
                    />
                </ListItem>
            ) : null}

            {pendingToken ? (
                <ListItem
                    withHorizontalPadding
                    onPress={busy ? undefined : onCompleteAuthorize}>
                    <ListItem.Content
                        title={t("lastfm.authorizeStep2")}
                        description={t("lastfm.authorizeStep2Desc")}
                    />
                </ListItem>
            ) : null}

            {status.authorized ? (
                <ListItem withHorizontalPadding onPress={onSignOut}>
                    <ListItem.Content title={t("lastfm.signOut")} />
                </ListItem>
            ) : null}

            <ListItemHeader>{t("lastfm.scrobbling")}</ListItemHeader>

            <ListItem
                withHorizontalPadding
                onPress={() => {
                    Config.setConfig("lastfm.enabled", !enabled);
                }}>
                <ListItem.Content
                    title={t("lastfm.enabled")}
                    description={t("lastfm.enabledDesc")}
                />
                <ThemeSwitch
                    value={enabled ?? false}
                    onValueChange={() => {
                        Config.setConfig("lastfm.enabled", !enabled);
                    }}
                />
            </ListItem>

            <ListItem
                withHorizontalPadding
                onPress={() => {
                    Config.setConfig("lastfm.nowPlaying", nowPlaying === false);
                }}>
                <ListItem.Content title={t("lastfm.nowPlaying")} />
                <ThemeSwitch
                    value={nowPlaying !== false}
                    onValueChange={() => {
                        Config.setConfig(
                            "lastfm.nowPlaying",
                            nowPlaying === false,
                        );
                    }}
                />
            </ListItem>

            <ListItem withHorizontalPadding onPress={busy ? undefined : onFlushNow}>
                <ListItem.Content
                    title={t("lastfm.pending")}
                    description={t("lastfm.pendingDesc", {
                        count: status.pendingCount,
                    })}
                />
            </ListItem>

            {status.pendingCount > 0 ? (
                <ListItem withHorizontalPadding onPress={onClearPending}>
                    <ListItem.Content title={t("lastfm.clearPending")} />
                </ListItem>
            ) : null}
        </ScrollView>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
});
