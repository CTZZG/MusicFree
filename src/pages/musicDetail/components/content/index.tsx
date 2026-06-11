import React, { useState } from "react";
import { View } from "react-native";
import AlbumCover from "./albumCover";
import Lyric from "./lyric";
import useOrientation from "@/hooks/useOrientation";
import Config from "@/core/appConfig";
import globalStyle from "@/constants/globalStyle";

interface IContentProps {
    immersiveMode?: boolean;
}

export default function Content(props: IContentProps) {
    const { immersiveMode = false } = props;
    const [tab, selectTab] = useState<"album" | "lyric">(
        Config.getConfig("basic.musicDetailDefault") || "album",
    );
    const orientation = useOrientation();
    const showAlbumCover = tab === "album" || orientation === "horizontal";

    const onTurnPageClick = () => {
        if (orientation === "horizontal") {
            return;
        }
        if (tab === "album") {
            selectTab("lyric");
        } else {
            selectTab("album");
        }
    };

    return (
        <View style={globalStyle.fwflex1}>
            {showAlbumCover ? (
                <AlbumCover
                    immersiveMode={immersiveMode}
                    onTurnPageClick={onTurnPageClick}
                />
            ) : (
                <Lyric
                    immersiveMode={immersiveMode}
                    onTurnPageClick={onTurnPageClick}
                />
            )}
        </View>
    );
}
