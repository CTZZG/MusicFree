import React, { forwardRef } from "react";
import Svg, { Defs, LinearGradient, Stop, Rect, Image, Text, G } from "react-native-svg";
import { CARD_WIDTH, getShareCardLayout, type ShareLyricLine } from "./cardLayout";

export interface ShareCardProps {
    title: string;
    artist: string;
    lines: ShareLyricLine[];
    translation: boolean;
    color: string;
    artwork?: string;
    width: number;
    onArtworkLoad: () => void;
}

export default forwardRef<Svg, ShareCardProps>(function ShareCard(props, ref) {
    const { title, artist, lines, translation, color, artwork, width, onArtworkLoad } =
        props;
    const layout = getShareCardLayout(title, artist, lines, translation);
    return (
        <Svg
            ref={ref}
            width={width}
            height={(width * layout.height) / CARD_WIDTH}
            viewBox={`0 0 ${CARD_WIDTH} ${layout.height}`}>
            <Defs>
                <LinearGradient id="card-gradient" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0" stopColor={color} />
                    <Stop offset="1" stopColor="#122030" />
                </LinearGradient>
            </Defs>
            <Rect width={CARD_WIDTH} height={layout.height} fill="url(#card-gradient)" />
            <Rect width={CARD_WIDTH} height={layout.height} fill="black" opacity={0.3} />
            <Rect
                x={70}
                y={68}
                width={128}
                height={128}
                rx={20}
                fill="white"
                opacity={0.12}
            />
            {artwork ? (
                <Image
                    key={artwork}
                    x={70}
                    y={68}
                    width={128}
                    height={128}
                    href={{ uri: artwork }}
                    preserveAspectRatio="xMidYMid slice"
                    onLoad={onArtworkLoad}
                />
            ) : (
                <Text x={112} y={154} fill="white" fontSize={64}>
                    ♪
                </Text>
            )}
            <G fill="white">
                {layout.title.map((row, i) => (
                    <Text
                        key={`title-${i}`}
                        x={230}
                        y={106 + i * 46}
                        fontSize={36}
                        fontWeight="bold">
                        {row}
                    </Text>
                ))}
                {layout.artist.map((row, i) => (
                    <Text
                        key={`artist-${i}`}
                        x={230}
                        y={190}
                        fontSize={25}
                        opacity={0.75}>
                        {row}
                    </Text>
                ))}
                {layout.text.map((row, i) => (
                    <Text
                        key={i}
                        x={70}
                        y={row.y}
                        fontSize={row.secondary ? 30 : 48}
                        opacity={row.secondary ? 0.72 : 1}
                        fontWeight={row.secondary ? "normal" : "bold"}>
                        {row.text}
                    </Text>
                ))}
                <Text x={70} y={layout.height - 55} fontSize={24} opacity={0.55}>
                    MusicFree
                </Text>
            </G>
        </Svg>
    );
});
