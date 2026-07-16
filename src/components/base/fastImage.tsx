import React, { useMemo, useState } from "react";
import { ImageRequireSource } from "react-native";
import { Image, ImageProps } from "expo-image";

interface IImageProps {
    style: ImageProps["style"];
    defaultSource?: ImageProps["defaultSource"];
    placeholderSource?: ImageRequireSource;
    source?: ImageProps["source"] | string;
    transition?: ImageProps["transition"];
}
export default function (props: IImageProps) {
    const {
        style,
        placeholderSource,
        defaultSource,
        source,
        transition,
    } = props ?? {};
    const [failedSourceKey, setFailedSourceKey] = useState<string>();


    let realSource: IImageProps["source"];
    if (typeof source === "string") {
        realSource = { uri: source };
        if (source.length === 0) {
            realSource = placeholderSource;
        }
    } else if (source){
        realSource = source;
    } else {
        realSource = placeholderSource;
    }


    const sourceKey = useMemo(() => JSON.stringify(realSource ?? null), [realSource]);
    const isError = failedSourceKey === sourceKey;


    return (
        <Image
            style={style}
            source={isError ? placeholderSource : realSource}
            onError={() => {
                setFailedSourceKey(sourceKey);
            }}
            defaultSource={defaultSource}
            placeholder={defaultSource}
            transition={transition}
        />
    );
}
