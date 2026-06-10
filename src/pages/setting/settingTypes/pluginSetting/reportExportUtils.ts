import { writeFile } from "react-native-fs";

function padTime(value: number) {
    return `${value}`.padStart(2, "0");
}

export function getPluginDiagnosticReportFileName(date = new Date()) {
    return [
        "MusicFree-plugin-diagnostics",
        date.getFullYear(),
        padTime(date.getMonth() + 1),
        padTime(date.getDate()),
        padTime(date.getHours()),
        padTime(date.getMinutes()),
        padTime(date.getSeconds()),
    ].join("-") + ".txt";
}

export function getPluginTestSearchReportFileName(date = new Date()) {
    return [
        "MusicFree-plugin-test-search",
        date.getFullYear(),
        padTime(date.getMonth() + 1),
        padTime(date.getDate()),
        padTime(date.getHours()),
        padTime(date.getMinutes()),
        padTime(date.getSeconds()),
    ].join("-") + ".txt";
}

export function getPluginHealthCheckReportFileName(date = new Date()) {
    return [
        "MusicFree-plugin-health-check",
        date.getFullYear(),
        padTime(date.getMonth() + 1),
        padTime(date.getDate()),
        padTime(date.getHours()),
        padTime(date.getMinutes()),
        padTime(date.getSeconds()),
    ].join("-") + ".txt";
}

export function joinExportFolderPath(folder: string, filename: string) {
    return `${folder.replace(/[\\/]+$/, "")}/${filename}`;
}

export async function writePluginDiagnosticReport(
    folder: string,
    reportText: string,
) {
    const filename = getPluginDiagnosticReportFileName();
    await writeFile(joinExportFolderPath(folder, filename), reportText, "utf8");
    return filename;
}

export async function writePluginHealthCheckReport(
    folder: string,
    reportText: string,
) {
    const filename = getPluginHealthCheckReportFileName();
    await writeFile(joinExportFolderPath(folder, filename), reportText, "utf8");
    return filename;
}

export async function writePluginTestSearchReport(
    folder: string,
    reportText: string,
) {
    const filename = getPluginTestSearchReportFileName();
    await writeFile(joinExportFolderPath(folder, filename), reportText, "utf8");
    return filename;
}
