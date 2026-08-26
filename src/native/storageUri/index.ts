import { NativeModules, Platform } from "react-native";

export interface IStorageUriMetadata {
    uri: string;
    kind: "content-uri" | "file-path";
    exists: boolean;
    displayName: string | null;
    mimeType: string | null;
    size: number | null;
    modifiedAt: number | null;
}

export interface IMediaStoreAudioItem extends IStorageUriMetadata {
    duration: number | null;
    title: string | null;
    artist: string | null;
    album: string | null;
}

export interface IPickedStorageDocument extends IStorageUriMetadata {
    persisted: boolean;
}

interface IStorageUriNativeModule {
    getMetadata(uri: string): Promise<IStorageUriMetadata>;
    exists(uri: string): Promise<boolean>;
    readText(uri: string, maxBytes: number): Promise<string>;
    copyToApp(uri: string, destinationPath: string): Promise<void>;
    delete(uri: string): Promise<boolean>;
    pickDocuments(
        mimeTypes: string[],
        allowMultiple: boolean,
    ): Promise<IPickedStorageDocument[]>;
    pickDirectory(): Promise<IPickedStorageDocument | null>;
    listDirectoryDocuments(
        treeUri: string,
        extensions: string[],
    ): Promise<IPickedStorageDocument[]>;
    cancelDirectoryScan(): void;
    exportDocument(
        sourcePath: string,
        mimeType: string,
        displayName: string,
    ): Promise<IPickedStorageDocument | null>;
    queryAudioMediaStore(): Promise<IMediaStoreAudioItem[]>;
    requestWriteAccess(uri: string): Promise<boolean>;
    openReadFileDescriptor(uri: string): Promise<number>;
    closeFileDescriptor(fd: number): Promise<void>;
}

function getNativeModule(): IStorageUriNativeModule {
    const nativeModule = NativeModules.StorageUri as
        | IStorageUriNativeModule
        | undefined;
    if (Platform.OS !== "android" || !nativeModule) {
        throw new Error("Android StorageUri is unavailable");
    }
    return nativeModule;
}

const StorageUri: IStorageUriNativeModule = {
    async getMetadata(uri) {
        return await getNativeModule().getMetadata(uri);
    },
    async exists(uri) {
        return await getNativeModule().exists(uri);
    },
    async readText(uri, maxBytes) {
        return await getNativeModule().readText(uri, maxBytes);
    },
    async copyToApp(uri, destinationPath) {
        await getNativeModule().copyToApp(uri, destinationPath);
    },
    async delete(uri) {
        return await getNativeModule().delete(uri);
    },
    async pickDocuments(mimeTypes, allowMultiple) {
        return await getNativeModule().pickDocuments(
            mimeTypes,
            allowMultiple,
        );
    },
    async pickDirectory() {
        return await getNativeModule().pickDirectory();
    },
    async listDirectoryDocuments(treeUri, extensions) {
        return await getNativeModule().listDirectoryDocuments(
            treeUri,
            extensions,
        );
    },
    cancelDirectoryScan() {
        getNativeModule().cancelDirectoryScan();
    },
    async exportDocument(sourcePath, mimeType, displayName) {
        return await getNativeModule().exportDocument(
            sourcePath,
            mimeType,
            displayName,
        );
    },
    async queryAudioMediaStore() {
        return await getNativeModule().queryAudioMediaStore();
    },
    async requestWriteAccess(uri) {
        return Boolean(
            await getNativeModule().requestWriteAccess(uri),
        );
    },
    async openReadFileDescriptor(uri) {
        return await getNativeModule().openReadFileDescriptor(uri);
    },
    async closeFileDescriptor(fd) {
        await getNativeModule().closeFileDescriptor(fd);
    },
};

export default StorageUri;
