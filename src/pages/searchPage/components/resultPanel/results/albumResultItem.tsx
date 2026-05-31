import React from "react";
import AlbumItem from "@/components/mediaItem/albumItem";

interface IAlbumResultsProps {
    item: ICommon.WithMusicList<IAlbum.IAlbumItemBase>;
    index: number;
    pluginHash: string;
}

export default function AlbumResultItem(props: IAlbumResultsProps) {
    const { item: albumItem, pluginHash } = props;

    return <AlbumItem albumItem={albumItem} pluginHash={pluginHash} />;
}
