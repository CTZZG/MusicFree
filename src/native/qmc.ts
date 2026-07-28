import { NativeModules } from "react-native";

export interface IQmcStreamInfo {
    audioSize: number;
    extension: string;
    contentType: string;
}

interface IQmcNativeModule {
    registerStream(
        src: string,
        ekey?: string | null,
        headers?: Record<string, string> | null,
    ): Promise<string>;
    inspectStream(
        src: string,
        ekey?: string | null,
        headers?: Record<string, string> | null,
    ): Promise<IQmcStreamInfo>;
    decryptFile(
        inputPath: string,
        outputPath: string,
        ekey?: string | null,
    ): Promise<IQmcStreamInfo>;
}

const nativeModule = NativeModules.Qmc as IQmcNativeModule | undefined;

const qmcOutputContentTypes: Readonly<Record<string, string>> = Object.freeze({
    flac: "audio/flac",
    ogg: "audio/ogg",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
});

function requireInfo(info: IQmcStreamInfo): IQmcStreamInfo {
    const extension = typeof info?.extension === "string"
        ? info.extension.trim().toLowerCase()
        : "";
    const contentType = typeof info?.contentType === "string"
        ? info.contentType.trim().toLowerCase()
        : "";
    if (
        !info ||
        !Number.isSafeInteger(info.audioSize) ||
        info.audioSize <= 0 ||
        qmcOutputContentTypes[extension] !== contentType
    ) {
        throw new Error("QMC native module returned invalid stream metadata");
    }
    return {
        ...info,
        extension,
        contentType,
    };
}

const Qmc = {
    isAvailable() {
        return !!nativeModule?.registerStream &&
            !!nativeModule?.inspectStream &&
            !!nativeModule?.decryptFile;
    },

    async registerStream(
        src: string,
        ekey?: string,
        headers?: Record<string, string>,
    ): Promise<string> {
        if (!nativeModule?.registerStream) {
            throw new Error("QMC native module is unavailable");
        }
        return nativeModule.registerStream(src, ekey ?? null, headers ?? null);
    },

    async inspectStream(
        src: string,
        ekey?: string,
        headers?: Record<string, string>,
    ): Promise<IQmcStreamInfo> {
        if (!nativeModule?.inspectStream) {
            throw new Error("QMC stream inspection is unavailable");
        }
        return requireInfo(
            await nativeModule.inspectStream(src, ekey ?? null, headers ?? null),
        );
    },

    async decryptFile(
        inputPath: string,
        outputPath: string,
        ekey?: string,
    ): Promise<IQmcStreamInfo> {
        if (!nativeModule?.decryptFile) {
            throw new Error("QMC file decryption is unavailable");
        }
        return requireInfo(
            await nativeModule.decryptFile(inputPath, outputPath, ekey ?? null),
        );
    },
};

export default Qmc;
