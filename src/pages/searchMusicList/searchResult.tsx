import React from "react";
import MusicList from "@/components/musicList";
import { RequestStateCode } from "@/constants/commonConst";

interface ISearchResultProps {
    result: IMusic.IMusicItem[];
    musicSheet?: IMusic.IMusicSheetItem;
}

export default function SearchResult(props: ISearchResultProps) {
    const { result, musicSheet } = props;
    return (
        <MusicList
            musicList={result}
            musicSheet={musicSheet}
            state={RequestStateCode.IDLE}
        />
    );
}
