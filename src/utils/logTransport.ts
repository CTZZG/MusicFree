import { fileAsyncTransport, logger } from "react-native-logs";
import RNFS from "react-native-fs";
import pathConst from "@/constants/pathConst";

const errorLoggerConfig = {
    transport: fileAsyncTransport,
    transportOptions: {
        FS: RNFS,
        filePath: pathConst.logPath,
        fileName: "error-log-{date-today}.log",
    },
    dateFormat: "local",
};

const traceLoggerConfig = {
    transport: fileAsyncTransport,
    transportOptions: {
        FS: RNFS,
        filePath: pathConst.logPath,
        fileName: "trace-log.log",
    },
    dateFormat: "local",
};

export const log = logger.createLogger(errorLoggerConfig);
const traceLogger = logger.createLogger(traceLoggerConfig);
const forceTraceLog =
    process.env.EXPO_PUBLIC_MUSICFREE_PLAYER_BACKEND === "nitro-player";

export function emitTraceLog(
    desc: string,
    message: any,
    level: "info" | "error" = "info",
    persist = false,
) {
    if (__DEV__) {
        console.log(desc, message);
    }
    if (forceTraceLog || persist) {
        traceLogger[level]({
            desc,
            message,
        });
    }
}

export function emitErrorLog(
    desc: string,
    message: any,
    persistError: boolean,
    persistTrace: boolean,
) {
    if (!persistError) {
        return;
    }
    log.error({
        desc,
        message,
    });
    emitTraceLog(desc, message, "error", persistTrace);
}
