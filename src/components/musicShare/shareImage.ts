import { CachesDirectoryPath, mkdir, readDir, unlink, writeFile } from "react-native-fs";
import Share from "react-native-share";

const directory = `${CachesDirectoryPath}/musicfree-share`;
let sequence = 0;

/** Keep attachments for late receivers; prune only our own expired files on the next export. */
export async function shareCardPng(base64: string) {
    await mkdir(directory);
    const now = Date.now();
    const files = (await readDir(directory))
        .filter(file => /^card-\d+-\d+\.png$/.test(file.name))
        .sort((a, b) => Number(b.name.split("-")[1]) - Number(a.name.split("-")[1]));
    await Promise.all(
        files
            .filter(
                (file, index) =>
                    index >= 19 ||
                    now - Number(file.name.split("-")[1]) > 24 * 60 * 60 * 1000,
            )
            .map(file => unlink(file.path).catch(() => undefined)),
    );
    const file = `${directory}/card-${now}-${++sequence}.png`;
    try {
        await writeFile(file, base64, "base64");
        await Share.open({
            url: `file://${file}`,
            type: "image/png",
            failOnCancel: false,
        });
    } catch (error) {
        await unlink(file).catch(() => undefined);
        throw error;
    }
}

export function captureShareCard(
    capture: (done: (png: string) => void) => void,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error("Image export timed out")),
            5000,
        );
        try {
            capture(png => {
                clearTimeout(timeout);
                if (!png || png.length > 12 * 1024 * 1024)
                    reject(new Error("Invalid image export"));
                else resolve(png);
            });
        } catch (error) {
            clearTimeout(timeout);
            reject(error);
        }
    });
}
