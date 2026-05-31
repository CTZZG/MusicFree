import React from "react";
import AlbumItem from "@/components/mediaItem/albumItem";
import { useParams } from "@/core/router";

interface IAlbumContentProps {
    item: ICommon.WithMusicList<IAlbum.IAlbumItemBase>;
}
export default function AlbumContentItem(props: IAlbumContentProps) {
    const { item } = props;
    const { pluginHash } = useParams<"artist-detail">();
    return <AlbumItem albumItem={item} pluginHash={pluginHash} />;
}
