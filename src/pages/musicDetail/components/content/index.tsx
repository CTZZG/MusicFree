import React from "react";
import { View } from "react-native";
import AlbumCover from "./albumCover";
import Lyric from "./lyric";
import useOrientation from "@/hooks/useOrientation";
import globalStyle from "@/constants/globalStyle";

interface IContentProps {
    immersiveMode?: boolean;
    tab: "album" | "lyric";
    onTabChange(tab: "album" | "lyric"): void;
}

export default function Content(props: IContentProps) {
    const { immersiveMode = false, tab, onTabChange } = props;
    const orientation = useOrientation();
    const showAlbumCover = tab === "album" || orientation === "horizontal";

    const onTurnPageClick = () => {
        if (orientation === "horizontal") {
            return;
        }
        if (tab === "album") {
            onTabChange("lyric");
        } else {
            onTabChange("album");
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
