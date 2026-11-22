import React from "react";
import {
    requireNativeComponent,
    type NativeSyntheticEvent,
    type ViewProps,
} from "react-native";

interface VideoFrame {
    mediaId: string;
    loadGeneration: number;
}
export interface MpvVideoProps extends ViewProps {
    mediaId: string;
    loadGeneration: number;
    outputVisible: boolean;
    onVideoFrame?: (event: NativeSyntheticEvent<VideoFrame>) => void;
}

const NativeVideo = requireNativeComponent<MpvVideoProps>("MusicFreeMpvVideo");

/** Presentation only: this view cannot load a URL, seek or change playback intent. */
export default function MpvVideo(props: MpvVideoProps) {
    return <NativeVideo {...props} />;
}
