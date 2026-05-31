import React from "react";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import ListItem from "@/components/base/listItem";
import { ImgAsset } from "@/constants/assetsConst";
import TitleAndTag from "./titleAndTag";
import PluginManager from "@/core/pluginManager";
import Toast from "@/utils/toast";
import { useI18N } from "@/core/i18n";

interface IAlbumResultsProps {
    albumItem: ICommon.WithMusicList<IAlbum.IAlbumItemBase>;
    pluginHash?: string;
}

export default function AlbumItem(props: IAlbumResultsProps) {
    const { albumItem, pluginHash } = props;
    const navigate = useNavigate();
    const { t } = useI18N();

    const openAlbum = () => {
        const plugin = pluginHash
            ? PluginManager.getByHash(pluginHash)
            : PluginManager.getByMedia(albumItem);
        const hasAlbumId =
            albumItem?.id !== undefined &&
            albumItem?.id !== null &&
            String(albumItem.id).trim().length > 0;
        const hasEmbeddedMusicList = !!albumItem?.musicList?.length;

        if (
            (hasAlbumId && plugin?.supportedMethods.has("getAlbumInfo")) ||
            hasEmbeddedMusicList
        ) {
            navigate(ROUTE_PATH.ALBUM_DETAIL, {
                albumItem,
                pluginHash: plugin?.hash,
            });
            return;
        }

        if (albumItem?.title) {
            Toast.warn(t("searchPage.albumDetailFallback"));
            navigate(ROUTE_PATH.SEARCH_PAGE, {
                initialQuery: [albumItem.title, albumItem.artist]
                    .filter(Boolean)
                    .join(" "),
                initialSearchType: "music",
                pluginHash: plugin?.supportedMethods.has("search")
                    ? plugin.hash
                    : undefined,
            });
        }
    };

    return (
        <ListItem
            withHorizontalPadding
            heightType="big"
            onPress={openAlbum}>
            <ListItem.ListItemImage
                uri={albumItem.artwork}
                fallbackImg={ImgAsset.albumDefault}
            />
            <ListItem.Content
                title={
                    <TitleAndTag
                        title={albumItem.title}
                        tag={albumItem.platform}
                    />
                }
                description={`${albumItem.artist ?? ""}    ${
                    albumItem.date ?? ""
                }`}
            />
        </ListItem>
        // <ListItem
        //     left={{
        //         artwork: albumItem.artwork,
        //         fallback: ImgAsset.albumDefault,
        //     }}
        //     title={albumItem.title}
        //     desc={`${albumItem.artist ?? ''}    ${albumItem.date ?? ''}`}
        //     tag={albumItem.platform}
        //     onPress={() => {
        //         navigate(ROUTE_PATH.ALBUM_DETAIL, {
        //             albumItem,
        //         });
        //     }}
        // />
    );
}
