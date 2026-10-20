# Shrink unused Java/Kotlin code, preserving names for native/reflective contracts
# and public, readable crash reports. Optimization remains governed by the SDK's
# proguard-android.txt; resource shrinking is deliberately unchanged.
-dontobfuscate

# CencNative uses exported Java_* JNI symbols. MPVLib's equivalent rule ships in
# libmpv-release.aar. React Native / Expo provide consumer rules; MMKV / Nitro
# JNI classes carry @Keep / @DoNotStrip annotations.
-keepclasseswithmembers,includedescriptorclasses class fun.upup.musicfree.cenc.CencNative {
    native <methods>;
}

# jaudiotagger constructs ID3 frame bodies by "FrameBody" + on-disk frame ID and
# uses reflective public/copy constructors. Keep this family, not the whole jar.
-keep class org.jaudiotagger.tag.id3.framebody.FrameBody* {
    public <init>(...);
}

# ID3Tags.copyObject() converts older tags by reflecting on each field's exact
# runtime type. FrameBody constructors alone do not retain these copy paths.
-keepclassmembers class org.jaudiotagger.tag.datatype.** {
    public <init>(...);
}

# ChunkContainerReader registers ASF/WMA readers through Class.newInstance().
# Several no-arg constructors are package-private, so retain all visibilities.
-keepclassmembers class * implements org.jaudiotagger.audio.asf.io.ChunkReader {
    <init>();
}

# Mp3UtilModule sets this private FLAC cover field via getDeclaredField().
-keepclassmembers class org.jaudiotagger.audio.flac.metadatablock.MetadataBlockDataPicture {
    private int pictureType;
}
