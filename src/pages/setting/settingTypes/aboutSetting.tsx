import React from "react";
import {
    Image,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
} from "react-native";
import rpx from "@/utils/rpx";
import { ImgAsset } from "@/constants/assetsConst";
import ThemeText from "@/components/base/themeText";
import LinkText from "@/components/base/linkText";
import useCheckUpdate from "@/hooks/useCheckUpdate.ts";
import useOrientation from "@/hooks/useOrientation";
import Divider from "@/components/base/divider";
import { buildInfo } from "@/constants/buildInfo.generated";
import DeviceInfo from "react-native-device-info";
import TrackPlayer, {
    IPlaybackDiagnosticSnapshot,
} from "@/core/trackPlayer";
import PluginManager from "@/core/pluginManager";
import timeformat from "@/utils/timeformat";
import Clipboard from "@react-native-clipboard/clipboard";
import Toast from "@/utils/toast";
import { showDialog } from "@/components/dialogs/useDialog";
import { useI18N } from "@/core/i18n";

export default function AboutSetting() {
    const checkAndShowResult = useCheckUpdate();
    const orientation = useOrientation();
    const { t } = useI18N();
    const buildRows = [
        {
            label: "应用版本",
            value: `${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`,
        },
        {
            label: "构建版本",
            value: `${buildInfo.appVersion} / ${buildInfo.versionCode}`,
        },
        {
            label: "Git",
            value: `${buildInfo.shortSha} · ${buildInfo.gitRef}`,
        },
        {
            label: "构建引用",
            value: buildInfo.gitRefType,
        },
        {
            label: "构建运行",
            value: buildInfo.buildRunUrl || "-",
        },
        {
            label: "构建时间",
            value: buildInfo.buildDate,
        },
        {
            label: "签名状态",
            value: buildInfo.signing,
        },
        {
            label: "依赖基线",
            value: `RN ${buildInfo.reactNative} · Expo ${buildInfo.expo} · React ${buildInfo.react}`,
        },
        {
            label: "播放器",
            value: buildInfo.nitroPlayer,
        },
    ];

    function formatValue(value?: string | number | null) {
        if (value === null || value === undefined || value === "") {
            return "-";
        }
        return `${value}`;
    }

    function formatProgress(snapshot: IPlaybackDiagnosticSnapshot) {
        const duration =
            snapshot.progress.duration ||
            snapshot.currentMusic?.duration ||
            snapshot.activeTrack?.duration ||
            0;
        return `${timeformat(snapshot.progress.position)} / ${timeformat(duration)}`;
    }

    function formatPlaybackDiagnostic(snapshot: IPlaybackDiagnosticSnapshot) {
        const currentMusic = snapshot.currentMusic;
        const currentPlugin = currentMusic
            ? PluginManager.getByMedia(currentMusic)
            : null;
        const queueIndex =
            snapshot.queueIndex >= 0 ? snapshot.queueIndex + 1 : "-";
        const recentErrors = snapshot.recentErrors.length
            ? snapshot.recentErrors.map(error => {
                const createdAt = new Date(error.createdAt).toLocaleString();
                return `${createdAt} ${error.code ? `[${error.code}] ` : ""}${error.message}`;
            })
            : ["-"];

        return [
            "构建",
            ...buildRows.map(row => `${row.label}: ${row.value}`),
            "",
            "当前播放",
            `歌曲: ${formatValue(currentMusic?.title)}`,
            `歌手: ${formatValue(currentMusic?.artist)}`,
            `专辑: ${formatValue(currentMusic?.album)}`,
            `平台: ${formatValue(currentMusic?.platform)}`,
            `插件: ${formatValue(currentPlugin?.name ?? currentMusic?.platform)}`,
            `队列索引: ${queueIndex} / ${snapshot.queueLength}`,
            `进度: ${formatProgress(snapshot)}`,
            `播放状态: ${snapshot.backendState}`,
            `播放模式: ${snapshot.repeatMode}`,
            `音质: ${snapshot.quality}`,
            `速率: ${snapshot.rate}`,
            "",
            "播放后端",
            `后端: ${snapshot.backendName}`,
            `后端循环模式: ${formatValue(snapshot.backendRepeatMode)}`,
            `Native 活动索引: ${formatValue(snapshot.activeTrackIndex)}`,
            `音源类型: ${formatValue(snapshot.activeTrack?.urlType)}`,
            `Headers: ${snapshot.activeTrack?.hasHeaders ? "yes" : "no"}`,
            "",
            "最近错误",
            ...recentErrors,
        ].join("\n");
    }

    function renderDiagnosticContent(diagnosticText: string) {
        return (
            <View>
                <TouchableOpacity
                    style={style.diagnosticRefresh}
                    onPress={showPlaybackDiagnostics}>
                    <ThemeText fontSize="description" fontWeight="bold">
                        刷新
                    </ThemeText>
                </TouchableOpacity>
                <ThemeText
                    selectable
                    fontSize="description"
                    style={style.diagnosticText}>
                    {diagnosticText}
                </ThemeText>
            </View>
        );
    }

    async function showPlaybackDiagnostics() {
        try {
            const snapshot =
                await TrackPlayer.getPlaybackDiagnosticSnapshot();
            const diagnosticText = formatPlaybackDiagnostic(snapshot);
            showDialog("SimpleDialog", {
                title: "播放诊断",
                content: renderDiagnosticContent(diagnosticText),
                okText: "复制诊断",
                onOk() {
                    Clipboard.setString(diagnosticText);
                    Toast.success(t("toast.copiedToClipboard"));
                },
            });
        } catch (e: any) {
            Toast.warn(t("toast.unknownError", {
                reason: e?.message ?? e,
            }));
        }
    }

    return (
        <View
            style={[
                style.wrapper,
                orientation === "horizontal"
                    ? {
                        flexDirection: "row",
                    }
                    : null,
            ]}>
            <View
                style={[
                    style.header,
                    orientation === "horizontal" ? style.horizontalSize : null,
                ]}>
                <TouchableOpacity
                    onPress={() => {
                        checkAndShowResult(true);
                    }}>
                    <Image
                        source={ImgAsset.author}
                        style={style.image}
                        resizeMode="contain"
                    />
                </TouchableOpacity>
                <ThemeText style={style.margin}>软件作者: 猫头猫</ThemeText>
                <ThemeText style={style.margin}>
                    公众号: 【一只猫头猫】
                </ThemeText>
                <View style={style.contactContainer}>
                    <ThemeText style={style.margin}>
                        B站:{" "}
                        <LinkText linkTo="https://space.bilibili.com/12866223">
                            不想睡觉猫头猫
                        </LinkText>
                    </ThemeText>
                    <ThemeText style={style.margin}>
                        小红书:{" "}
                        <LinkText linkTo="https://www.xiaohongshu.com/user/profile/5ce6085200000000050213a6?xsec_token=YBqVNCKP4kpvphpU5sZI8WC93c5JINc3NhGtRBymgKvuo%3D&xsec_source=app_share&xhsshare=CopyLink&appuid=5ce6085200000000050213a6&apptime=1747275535&share_id=faef5820564a43be80e5b77da887e4b9&share_channel=copy_link">
                            一只猫头猫
                        </LinkText>
                    </ThemeText>
                </View>
            </View>
            <ScrollView
                contentContainerStyle={style.scrollViewContainer}
                style={style.scrollView}>
                <ThemeText fontSize="title">构建信息: </ThemeText>
                <View style={style.buildInfoCard}>
                    {buildRows.map(row => (
                        <View key={row.label} style={style.buildInfoRow}>
                            <ThemeText
                                fontSize="description"
                                fontColor="textSecondary"
                                style={style.buildInfoLabel}>
                                {row.label}
                            </ThemeText>
                            <ThemeText
                                selectable
                                fontSize="description"
                                style={style.buildInfoValue}>
                                {row.value}
                            </ThemeText>
                        </View>
                    ))}
                    <TouchableOpacity
                        style={style.diagnosticEntry}
                        onPress={showPlaybackDiagnostics}>
                        <ThemeText fontSize="description" fontWeight="bold">
                            播放诊断
                        </ThemeText>
                    </TouchableOpacity>
                </View>
                <Divider style={style.content} />

                <ThemeText fontSize="title">开发者的话: </ThemeText>
                <ThemeText style={style.content}>
                    软件作者是<ThemeText fontWeight="bold">猫头猫</ThemeText>
                    🐱，不是猫头鹰🦉，也不是什么其他的奇奇怪怪。软件没有其他版本，如果你下载到了付费版/广告版/挂羊头卖狗肉版，那说明你被坏蛋骗了😒。
                </ThemeText>
                <ThemeText style={style.content}>
                    软件相关信息会发布在公众号【
                    <ThemeText fontWeight="bold">一只猫头猫</ThemeText>
                    】中👇，也简单做了个
                    <LinkText linkTo="https://musicfree.catcat.work">
                        官方网站
                    </LinkText>
                    。（手机版和桌面版的）下载地址、使用方式、插件开发方式、常见问题都在站点中。
                </ThemeText>
                <Image
                    source={ImgAsset.wechatChannel}
                    style={style.wcChannel}
                />
                <Divider style={style.content} />

                <ThemeText style={style.content}>
                    本软件完全免费，并基于{" "}
                    <ThemeText fontWeight="bold">AGPL3.0 协议</ThemeText>{" "}
                    开源，如果需要使用此代码进行二次开发，请遵守如下约定：
                </ThemeText>

                <ThemeText style={style.content}>
                    1. 二次分发版必须同样遵循 AGPL 3.0 协议，开源且免费
                </ThemeText>
                <ThemeText style={style.content}>
                    2. 合法合规使用代码，不要用于商业用途;
                    修改后的软件造成的任何问题由使用此代码的开发者承担
                </ThemeText>
                <ThemeText style={style.content}>
                    3.
                    打包、二次分发时请保留代码出处：https://github.com/maotoumao/MusicFree
                </ThemeText>
                <ThemeText style={style.content}>
                    4. 如果开源协议变更，将在此 Github 仓库更新，不另行通知
                </ThemeText>
                <ThemeText style={style.content}>
                    代码已开源到{" "}
                    <LinkText linkTo="https://github.com/maotoumao/MusicFree">
                        Github
                    </LinkText>
                    ，如果打不开试试把链接中的 github 换成 gitcode。
                </ThemeText>

                <Divider style={style.content} />

                <ThemeText style={style.content}>
                    本软件需要通过插件来完成包括播放、搜索在内的大部分功能，如果你是从第三方下载的插件，
                    <ThemeText fontWeight="bold">
                        请一定谨慎识别这些插件的安全性，保护好自己。（注意：插件以及插件可能产生的数据与本软件无关，请使用者合理合法使用。）
                    </ThemeText>
                </ThemeText>

                <ThemeText style={style.content}>
                    <ThemeText fontWeight="bold">
                        还请注意本软件只是个人的业余项目，距离稳定版也有很长一段距离。
                    </ThemeText>
                    如果你在找成熟稳定的音乐软件，可以考虑其他优秀的软件。当然我会一直维护，让它变得尽可能的完善一些。业余时间用爱发电，进度慢还请见谅。
                </ThemeText>

                <ThemeText style={style.content}>
                    如果有问题或者建议，可以直接去 Github issue
                    区留言，也可以去公众号【一只猫头猫】留言，也可以去{" "}
                    <LinkText linkTo="https://qun.qq.com/qqweb/qunpro/share?_wv=3&_wwv=128&appChannel=share&inviteCode=1XgzeY8LfIa&businessType=9&from=246610&biz=ka&mainSourceId=share&subSourceId=others&jumpsource=shorturl">
                        QQ 频道
                    </LinkText>{" "}
                    发帖。
                </ThemeText>

                <ThemeText style={style.content}>
                    开发这个软件的最初目的是自用，顺便分享出来给有需要的人。如果这个软件能对你有些帮助，那这就是
                    MusicFree 存在的意义。
                </ThemeText>

                <ThemeText style={style.content}>by: 猫头猫</ThemeText>
            </ScrollView>
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    header: {
        width: rpx(750),
        height: rpx(400),
        justifyContent: "center",
        alignItems: "center",
    },
    contactContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: rpx(24),
    },
    horizontalSize: {
        width: rpx(600),
        height: "100%",
    },
    image: {
        width: rpx(150),
        height: rpx(150),
        borderRadius: rpx(28),
    },
    margin: {
        marginTop: rpx(24),
    },
    content: {
        marginTop: rpx(24),
        lineHeight: rpx(48),
    },
    buildInfoCard: {
        marginTop: rpx(24),
    },
    buildInfoRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        marginTop: rpx(14),
    },
    buildInfoLabel: {
        width: rpx(150),
        lineHeight: rpx(34),
    },
    buildInfoValue: {
        flex: 1,
        lineHeight: rpx(34),
    },
    diagnosticEntry: {
        marginTop: rpx(20),
    },
    diagnosticRefresh: {
        alignSelf: "flex-start",
        marginBottom: rpx(20),
    },
    diagnosticText: {
        lineHeight: rpx(38),
    },
    wcChannel: {
        width: rpx(330),
        height: rpx(330),
        marginLeft: rpx(210),
        marginTop: rpx(24),
    },
    scrollView: {
        flex: 1,
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(48),
    },
    scrollViewContainer: {
        paddingBottom: rpx(96),
    },
});
