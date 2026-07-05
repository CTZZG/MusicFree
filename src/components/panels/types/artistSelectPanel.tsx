import React from "react";
import { StyleSheet, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Divider from "@/components/base/divider";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { iconSizeConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import pluginManager from "@/core/pluginManager";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import rpx from "@/utils/rpx";
import PanelBase from "../base/panelBase";
import { hidePanel } from "../usePanel";

interface ISingerInfo {
    id?: number | string;
    mid?: string;
    name: string;
    avatar?: string;
    searchOnly?: boolean;
}

interface IArtistSelectPanelProps {
    singerList: ISingerInfo[];
    platform: string;
    pluginHash?: string;
}

const ITEM_HEIGHT = rpx(96);

export default function ArtistSelectPanel(props: IArtistSelectPanelProps) {
    const { singerList = [], platform, pluginHash } = props ?? {};
    const { t } = useI18N();
    const safeAreaInsets = useSafeAreaInsets();
    const navigate = useNavigate();

    const handleArtistPress = (singer: ISingerInfo) => {
        const plugin =
            (pluginHash ? pluginManager.getByHash(pluginHash) : undefined) ??
            pluginManager.getByName(platform);
        const shouldSearch =
            singer.searchOnly ||
            singer.id === undefined ||
            singer.id === null ||
            !plugin?.supportedMethods.has("getArtistWorks");

        if (shouldSearch) {
            hidePanel();
            setTimeout(() => {
                navigate(ROUTE_PATH.SEARCH_PAGE, {
                    initialQuery: singer.name,
                    initialSearchType: "artist",
                    pluginHash: plugin?.supportedMethods.has("search")
                        ? plugin.hash
                        : undefined,
                });
            }, 100);
            return;
        }

        const artistItem: IArtist.IArtistItemBase = {
            id: String(singer.id),
            singerMID: singer.mid,
            name: singer.name,
            platform,
            avatar: singer.avatar || "",
            worksNum: 0,
        };

        hidePanel();
        setTimeout(() => {
            navigate(ROUTE_PATH.ARTIST_DETAIL, {
                artistItem,
                pluginHash: plugin?.hash ?? "",
            });
        }, 100);
    };

    return (
        <PanelBase
            height={rpx(Math.min(singerList.length * 96 + 200, 800))}
            renderBody={() => (
                <>
                    <View style={styles.header}>
                        <ThemeText style={styles.title}>
                            {t("panel.artistSelect.title")}
                        </ThemeText>
                        <ThemeText
                            fontColor="textSecondary"
                            fontSize="description">
                            {t("panel.artistSelect.description")}
                        </ThemeText>
                    </View>
                    <Divider />
                    <View style={styles.wrapper}>
                        <FlatList
                            data={singerList}
                            getItemLayout={(_, index) => ({
                                length: ITEM_HEIGHT,
                                offset: ITEM_HEIGHT * index,
                                index,
                            })}
                            keyExtractor={(item, index) =>
                                `${item.id}-${item.mid ?? ""}-${index}`
                            }
                            ListFooterComponent={
                                <View
                                    style={[
                                        styles.footer,
                                        {
                                            height:
                                                rpx(30) +
                                                safeAreaInsets.bottom,
                                        },
                                    ]}
                                />
                            }
                            renderItem={({ item }) => (
                                <ListItem
                                    withHorizontalPadding
                                    heightType="small"
                                    onPress={() => handleArtistPress(item)}>
                                    <ListItem.ListItemIcon
                                        width={rpx(48)}
                                        icon="user"
                                        iconSize={iconSizeConst.light}
                                    />
                                    <ListItem.Content title={item.name} />
                                </ListItem>
                            )}
                            style={styles.listWrapper}
                        />
                    </View>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: rpx(750),
        flex: 1,
    },
    header: {
        width: rpx(750),
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(24),
    },
    title: {
        marginBottom: rpx(8),
    },
    listWrapper: {
        paddingTop: rpx(12),
    },
    footer: {
        width: rpx(750),
    },
});
