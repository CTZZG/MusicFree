import React, { useMemo, useState } from "react";
import { ImageRequireSource } from "react-native";
import { Image, ImageProps } from "expo-image";

/**
 * 两种「占位」容易混：
 * - placeholderSource 是兜底图：没有地址、或地址加载失败时，换成它显示。
 *   加载过程中不显示它，避免先闪一下默认封面再换成真封面。
 * - defaultSource 才是加载中的占位（expo-image 的 placeholder）。大多数调用方
 *   不传，加载中露出的是容器自己的底色，所以带投影的容器底色必须不透明
 *   （见主题色 artworkPlaceholder）。
 */
interface IImageProps {
    style: ImageProps["style"];
    /** 加载中显示的占位图 */
    defaultSource?: ImageProps["defaultSource"];
    /** 没有地址或加载失败时的兜底图 */
    placeholderSource?: ImageRequireSource;
    source?: ImageProps["source"] | string;
    transition?: ImageProps["transition"];
    /** 图片（不含 placeholder）真正画出来时 */
    onDisplay?: ImageProps["onDisplay"];
}
export default function (props: IImageProps) {
    const {
        style,
        placeholderSource,
        defaultSource,
        source,
        transition,
        onDisplay,
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
            onDisplay={onDisplay}
        />
    );
}
