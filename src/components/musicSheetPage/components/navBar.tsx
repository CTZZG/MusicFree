import React from "react";

import { ROUTE_PATH, useNavigate } from "@/core/router";
import AppBar from "@/components/base/appBar";
import { IIconName } from "@/components/base/icon.tsx";

interface INavBarProps {
    navTitle: string;
    musicList: IMusic.IMusicItem[] | null;
    menu?: Array<{
        icon: IIconName;
        title: string;
        show?: boolean;
        onPress?: () => void;
    }>;
}

export default function (props: INavBarProps) {
    const navigate = useNavigate();
    const { navTitle, musicList = [], menu = [] } = props;

    return (
        <AppBar
            actions={[
                {
                    icon: "magnifying-glass",
                    onPress() {
                        navigate(ROUTE_PATH.SEARCH_MUSIC_LIST, {
                            musicList: musicList,
                        });
                    },
                },
            ]}
            menu={[
                ...menu,
                {
                    icon: "pencil-square",
                    title: "批量编辑",
                    onPress() {
                        navigate(ROUTE_PATH.MUSIC_LIST_EDITOR, {
                            musicList: musicList,
                            musicSheet: {
                                title: navTitle,
                            },
                        });
                    },
                },
            ]}>
            {navTitle}
        </AppBar>
    );
}
