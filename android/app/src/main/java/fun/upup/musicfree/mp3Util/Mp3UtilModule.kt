package `fun`.upup.musicfree.mp3Util

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import com.facebook.react.bridge.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.max

class Mp3UtilModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "Mp3Util"

    private val maxCoverBytes = 20 * 1024 * 1024
    private val maxCoverBitmapSide = 1024
    private val metadataExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "MusicFree-Metadata").apply { isDaemon = true }
    }
    private val coverHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build()

    private fun isContentUri(uri: Uri?): Boolean {
        return uri?.scheme?.equals("content", ignoreCase = true) == true
    }

    private val metadataUnsafeExtensions = setOf(
        ".ape",
        ".asf",
        ".dff",
        ".dsf",
        ".wma",
    )

    private fun lowerFileExtension(filePath: String): String {
        val pathWithoutQuery = filePath.substringBefore("?")
        val slashIndex = maxOf(
            pathWithoutQuery.lastIndexOf('/'),
            pathWithoutQuery.lastIndexOf('\\'),
        )
        val dotIndex = pathWithoutQuery.lastIndexOf('.')
        return if (dotIndex > slashIndex) {
            pathWithoutQuery.substring(dotIndex).lowercase(Locale.ROOT)
        } else {
            ""
        }
    }

    private fun shouldUseMediaMetadataRetriever(filePath: String): Boolean {
        return !metadataUnsafeExtensions.contains(lowerFileExtension(filePath))
    }

    private fun extractBasicMeta(mmr: MediaMetadataRetriever): WritableMap {
        return Arguments.createMap().apply {
            putString("duration", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))
            putString("bitrate", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE))
            putString("artist", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST))
            putString("author", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_AUTHOR))
            putString("album", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM))
            putString("title", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE))
            putString("date", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DATE))
            putString("year", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR))
        }
    }

    private fun downloadImageBytes(imageUrl: String): ByteArray? {
        return try {
            val request = Request.Builder()
                .url(imageUrl)
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
                )
                .header("Accept", "image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.1")
                .build()
            coverHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    android.util.Log.w("Mp3UtilModule", "Cover request failed: HTTP ${response.code}")
                    return@use null
                }
                val body = response.body ?: return@use null
                val contentLength = body.contentLength()
                if (contentLength > maxCoverBytes) {
                    android.util.Log.w("Mp3UtilModule", "Cover is too large: $contentLength bytes")
                    return@use null
                }
                val bytes = body.bytes()
                if (bytes.isEmpty() || bytes.size > maxCoverBytes) {
                    android.util.Log.w("Mp3UtilModule", "Invalid cover size: ${bytes.size} bytes")
                    null
                } else {
                    bytes
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("Mp3UtilModule", "Failed to download image: ${e.message}", e)
            null
        }
    }

    private fun getOptionalString(meta: ReadableMap, key: String): String? {
        if (!meta.hasKey(key) || meta.isNull(key)) {
            return null
        }

        return when (meta.getType(key)) {
            ReadableType.String -> meta.getString(key)
            ReadableType.Number -> {
                val value = meta.getDouble(key)
                if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
            }
            ReadableType.Boolean -> meta.getBoolean(key).toString()
            else -> null
        }
    }

    private fun getOptionalBoolean(meta: ReadableMap, key: String): Boolean? {
        if (!meta.hasKey(key) || meta.isNull(key)) {
            return null
        }

        return when (meta.getType(key)) {
            ReadableType.Boolean -> meta.getBoolean(key)
            ReadableType.Number -> meta.getDouble(key) != 0.0
            ReadableType.String -> {
                val value = meta.getString(key)?.lowercase()
                value == "1" || value == "true" || value == "yes"
            }
            else -> null
        }
    }

    private fun setOptionalTagField(
        tag: org.jaudiotagger.tag.Tag,
        meta: ReadableMap,
        metaKey: String,
        fieldKey: FieldKey,
    ) {
        getOptionalString(meta, metaKey)?.let { tag.setField(fieldKey, it) }
    }

    private fun applyMediaTagFields(tag: org.jaudiotagger.tag.Tag, meta: ReadableMap) {
        setOptionalTagField(tag, meta, "title", FieldKey.TITLE)
        setOptionalTagField(tag, meta, "artist", FieldKey.ARTIST)
        setOptionalTagField(tag, meta, "album", FieldKey.ALBUM)
        setOptionalTagField(tag, meta, "lyric", FieldKey.LYRICS)
        setOptionalTagField(tag, meta, "comment", FieldKey.COMMENT)

        setOptionalTagField(tag, meta, "albumArtist", FieldKey.ALBUM_ARTIST)
        setOptionalTagField(tag, meta, "composer", FieldKey.COMPOSER)
        setOptionalTagField(tag, meta, "year", FieldKey.YEAR)
        setOptionalTagField(tag, meta, "genre", FieldKey.GENRE)
        setOptionalTagField(tag, meta, "trackNumber", FieldKey.TRACK)
        setOptionalTagField(tag, meta, "totalTracks", FieldKey.TRACK_TOTAL)
        setOptionalTagField(tag, meta, "discNumber", FieldKey.DISC_NO)
        setOptionalTagField(tag, meta, "totalDiscs", FieldKey.DISC_TOTAL)
        setOptionalTagField(tag, meta, "isrc", FieldKey.ISRC)
        setOptionalTagField(tag, meta, "language", FieldKey.LANGUAGE)
        setOptionalTagField(tag, meta, "encoder", FieldKey.ENCODER)
        setOptionalTagField(tag, meta, "bpm", FieldKey.BPM)
        setOptionalTagField(tag, meta, "mood", FieldKey.MOOD)
        setOptionalTagField(tag, meta, "rating", FieldKey.RATING)
        setOptionalTagField(tag, meta, "publisher", FieldKey.RECORD_LABEL)
        setOptionalTagField(tag, meta, "originalArtist", FieldKey.ORIGINAL_ARTIST)
        setOptionalTagField(tag, meta, "originalAlbum", FieldKey.ORIGINAL_ALBUM)
        setOptionalTagField(tag, meta, "originalYear", FieldKey.ORIGINAL_YEAR)
        setOptionalTagField(tag, meta, "url", FieldKey.URL_OFFICIAL_RELEASE_SITE)

        getOptionalBoolean(meta, "compilation")?.let { isCompilation ->
            tag.setField(FieldKey.IS_COMPILATION, if (isCompilation) "1" else "0")
        }
    }

    private fun readCoverBytes(coverPath: String): ByteArray? {
        val bytes = when {
            coverPath.startsWith("/") || coverPath.startsWith("file://") -> {
                val coverFile = File(
                    if (coverPath.startsWith("file://")) {
                        Uri.parse(coverPath).path ?: coverPath
                    } else {
                        coverPath
                    }
                )
                if (coverFile.exists()) coverFile.readBytes() else null
            }
            coverPath.startsWith("http://") || coverPath.startsWith("https://") -> {
                downloadImageBytes(coverPath)
            }
            else -> null
        }
        if (bytes != null && bytes.size > maxCoverBytes) {
            android.util.Log.w("Mp3UtilModule", "Cover image exceeds size limit: ${bytes.size} bytes")
            return null
        }
        return bytes
    }

    private data class ImageInfo(
        val width: Int,
        val height: Int,
        val colourDepth: Int,
    )

    private fun readImageInfo(coverBytes: ByteArray, mimeType: String): ImageInfo {
        val bitmapOptions = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        BitmapFactory.decodeByteArray(coverBytes, 0, coverBytes.size, bitmapOptions)
        return ImageInfo(
            width = if (bitmapOptions.outWidth > 0) bitmapOptions.outWidth else 0,
            height = if (bitmapOptions.outHeight > 0) bitmapOptions.outHeight else 0,
            colourDepth = if (mimeType == "image/png") 32 else 24,
        )
    }

    private fun calculateBitmapSampleSize(width: Int, height: Int, maxSide: Int): Int {
        var sampleSize = 1
        while (width / sampleSize > maxSide || height / sampleSize > maxSide) {
            sampleSize *= 2
        }
        return sampleSize.coerceAtLeast(1)
    }

    private fun decodeCoverBitmapBounded(
        coverBytes: ByteArray,
        maxSide: Int = maxCoverBitmapSide,
    ): Bitmap? {
        return try {
            val bounds = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            BitmapFactory.decodeByteArray(coverBytes, 0, coverBytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                return null
            }

            val options = BitmapFactory.Options().apply {
                inSampleSize = calculateBitmapSampleSize(
                    bounds.outWidth,
                    bounds.outHeight,
                    maxSide,
                )
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            val decoded = BitmapFactory.decodeByteArray(
                coverBytes,
                0,
                coverBytes.size,
                options,
            ) ?: return null
            val longestSide = max(decoded.width, decoded.height)
            if (longestSide <= maxSide) {
                decoded
            } else {
                val scale = maxSide.toFloat() / longestSide.toFloat()
                val scaled = Bitmap.createScaledBitmap(
                    decoded,
                    (decoded.width * scale).toInt().coerceAtLeast(1),
                    (decoded.height * scale).toInt().coerceAtLeast(1),
                    true,
                )
                decoded.recycle()
                scaled
            }
        } catch (error: OutOfMemoryError) {
            android.util.Log.e("Mp3UtilModule", "Cover bitmap decode OOM", error)
            null
        } catch (e: Exception) {
            android.util.Log.w("Mp3UtilModule", "Cover bitmap decode failed: ${e.message}", e)
            null
        }
    }

    private fun stableCacheKey(input: String): String {
        val digest = MessageDigest.getInstance("SHA-1")
            .digest(input.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun setCoverForOgg(filePath: String, coverBytes: ByteArray): Boolean {
        val mimeType = detectImageMimeTypeByBytes(coverBytes)
        val imageInfo = readImageInfo(coverBytes, mimeType)
        return OggCoverWriter.writeCover(
            filePath,
            coverBytes,
            mimeType,
            imageInfo.width,
            imageInfo.height,
            imageInfo.colourDepth,
        )
    }

    private fun setCoverArtImageIOFree(tag: org.jaudiotagger.tag.Tag, coverBytes: ByteArray, fileExtension: String): Boolean {
        return try {
            val mimeType = detectImageMimeTypeByBytes(coverBytes)
            when (fileExtension) {
                "mp3" -> setCoverForMp3(tag, coverBytes, mimeType)
                "flac" -> setCoverForFlac(tag, coverBytes, mimeType)
                "m4a", "mp4" -> setCoverForMp4(tag, coverBytes, mimeType)
                else -> false
            }
        } catch (e: Exception) {
            android.util.Log.e("Mp3UtilModule", "Failed to set cover art: ${e.message}", e)
            false
        }
    }

    private fun setCoverForMp3(tag: org.jaudiotagger.tag.Tag, coverBytes: ByteArray, mimeType: String): Boolean {
        return try {
            when (tag) {
                is org.jaudiotagger.tag.id3.ID3v24Tag -> {
                    val apicFrame = org.jaudiotagger.tag.id3.framebody.FrameBodyAPIC()
                    apicFrame.setObjectValue(org.jaudiotagger.tag.datatype.DataTypes.OBJ_TEXT_ENCODING, 0.toByte())
                    apicFrame.setObjectValue(org.jaudiotagger.tag.datatype.DataTypes.OBJ_MIME_TYPE, mimeType)
                    apicFrame.setObjectValue(org.jaudiotagger.tag.datatype.DataTypes.OBJ_PICTURE_TYPE, 3.toByte())
                    apicFrame.setObjectValue(org.jaudiotagger.tag.datatype.DataTypes.OBJ_DESCRIPTION, "")
                    apicFrame.setObjectValue(org.jaudiotagger.tag.datatype.DataTypes.OBJ_PICTURE_DATA, coverBytes)

                    val frame = org.jaudiotagger.tag.id3.ID3v24Frame(org.jaudiotagger.tag.id3.ID3v24Frames.FRAME_ID_ATTACHED_PICTURE)
                    frame.body = apicFrame
                    tag.setFrame(frame)
                    true
                }
                is org.jaudiotagger.tag.id3.ID3v23Tag -> {
                    val apicFrame = org.jaudiotagger.tag.id3.framebody.FrameBodyAPIC()
                    apicFrame.setObjectValue(org.jaudiotagger.tag.datatype.DataTypes.OBJ_TEXT_ENCODING, 0.toByte())
                    apicFrame.setObjectValue(org.jaudiotagger.tag.datatype.DataTypes.OBJ_MIME_TYPE, mimeType)
                    apicFrame.setObjectValue(org.jaudiotagger.tag.datatype.DataTypes.OBJ_PICTURE_TYPE, 3.toByte())
                    apicFrame.setObjectValue(org.jaudiotagger.tag.datatype.DataTypes.OBJ_DESCRIPTION, "")
                    apicFrame.setObjectValue(org.jaudiotagger.tag.datatype.DataTypes.OBJ_PICTURE_DATA, coverBytes)

                    val frame = org.jaudiotagger.tag.id3.ID3v23Frame(org.jaudiotagger.tag.id3.ID3v23Frames.FRAME_ID_V3_ATTACHED_PICTURE)
                    frame.body = apicFrame
                    tag.setFrame(frame)
                    true
                }
                else -> false
            }
        } catch (e: Exception) {
            android.util.Log.e("Mp3UtilModule", "Failed to set MP3 cover: ${e.message}", e)
            false
        }
    }

    private fun setCoverForFlac(tag: org.jaudiotagger.tag.Tag, coverBytes: ByteArray, mimeType: String): Boolean {
        return try {
            when (tag) {
                is org.jaudiotagger.tag.flac.FlacTag -> {
                    tag.deleteArtworkField()

                    try {
                        val bitmapOptions = BitmapFactory.Options().apply {
                            inJustDecodeBounds = true
                        }
                        BitmapFactory.decodeByteArray(coverBytes, 0, coverBytes.size, bitmapOptions)

                        val imageWidth = if (bitmapOptions.outWidth > 0) bitmapOptions.outWidth else 0
                        val imageHeight = if (bitmapOptions.outHeight > 0) bitmapOptions.outHeight else 0
                        val colourDepth = if (mimeType == "image/png") 32 else 24

                        val pictureBlock = org.jaudiotagger.audio.flac.metadatablock.MetadataBlockDataPicture(
                            coverBytes,
                            coverBytes.size,
                            mimeType,
                            "",
                            imageWidth,
                            imageHeight,
                            colourDepth,
                            0
                        )

                        try {
                            val pictureTypeField = pictureBlock.javaClass.getDeclaredField("pictureType")
                            pictureTypeField.isAccessible = true
                            pictureTypeField.set(pictureBlock, 3)
                        } catch (_: Exception) {
                        }

                        tag.addField(pictureBlock)
                        return true
                    } catch (e: Exception) {
                        android.util.Log.w("Mp3UtilModule", "Direct FLAC picture block failed: ${e.message}")
                    }

                    try {
                        val base64Cover = android.util.Base64.encodeToString(coverBytes, android.util.Base64.NO_WRAP)
                        tag.setField(FieldKey.COVER_ART, base64Cover)
                        return true
                    } catch (e: Exception) {
                        android.util.Log.w("Mp3UtilModule", "Base64 FLAC cover failed: ${e.message}")
                    }

                    false
                }
                else -> false
            }
        } catch (e: Exception) {
            android.util.Log.e("Mp3UtilModule", "Failed to set FLAC cover: ${e.message}", e)
            false
        }
    }

    private fun setCoverForMp4(tag: org.jaudiotagger.tag.Tag, coverBytes: ByteArray, mimeType: String): Boolean {
        return try {
            if (tag !is org.jaudiotagger.tag.mp4.Mp4Tag) {
                android.util.Log.w("Mp3UtilModule", "Unsupported MP4 tag type: ${tag.javaClass.simpleName}")
                return false
            }

            val mp4CoverBytes = if (mimeType !in setOf("image/jpeg", "image/png", "image/gif")) {
                val bitmap = decodeCoverBitmapBounded(coverBytes)
                    ?: throw IllegalArgumentException("Unable to decode cover image ($mimeType)")
                try {
                    ByteArrayOutputStream().use { output ->
                        if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                            throw IllegalStateException("Unable to convert cover to PNG")
                        }
                        output.toByteArray()
                    }
                } finally {
                    bitmap.recycle()
                }
            } else {
                coverBytes
            }

            tag.deleteField(org.jaudiotagger.tag.mp4.Mp4FieldKey.ARTWORK)
            tag.setField(tag.createArtworkField(mp4CoverBytes))
            true
        } catch (e: Exception) {
            android.util.Log.e("Mp3UtilModule", "Failed to set MP4/M4A cover: ${e.message}", e)
            false
        }
    }

    private fun detectImageMimeTypeByBytes(imageBytes: ByteArray): String {
        return when {
            imageBytes.size >= 3 &&
                imageBytes[0] == 0xFF.toByte() &&
                imageBytes[1] == 0xD8.toByte() &&
                imageBytes[2] == 0xFF.toByte() -> "image/jpeg"
            imageBytes.size >= 8 &&
                imageBytes[0] == 0x89.toByte() &&
                imageBytes[1] == 0x50.toByte() &&
                imageBytes[2] == 0x4E.toByte() &&
                imageBytes[3] == 0x47.toByte() -> "image/png"
            imageBytes.size >= 4 &&
                imageBytes[0] == 0x47.toByte() &&
                imageBytes[1] == 0x49.toByte() &&
                imageBytes[2] == 0x46.toByte() &&
                imageBytes[3] == 0x38.toByte() -> "image/gif"
            imageBytes.size >= 12 &&
                imageBytes[0] == 0x52.toByte() &&
                imageBytes[1] == 0x49.toByte() &&
                imageBytes[2] == 0x46.toByte() &&
                imageBytes[3] == 0x46.toByte() &&
                imageBytes[8] == 0x57.toByte() &&
                imageBytes[9] == 0x45.toByte() &&
                imageBytes[10] == 0x42.toByte() &&
                imageBytes[11] == 0x50.toByte() -> "image/webp"
            else -> "application/octet-stream"
        }
    }

    @ReactMethod
    fun getBasicMeta(filePath: String, promise: Promise) {
        if (!shouldUseMediaMetadataRetriever(filePath)) {
            promise.resolve(Arguments.createMap())
            return
        }
        val mmr = MediaMetadataRetriever()
        try {
            val uri = Uri.parse(filePath)
            if (isContentUri(uri)) {
                mmr.setDataSource(reactApplicationContext, uri)
            } else {
                mmr.setDataSource(filePath)
            }

            promise.resolve(extractBasicMeta(mmr))
        } catch (e: Exception) {
            promise.reject("Exception", e.message)
        } finally {
            try {
                mmr.release()
            } catch (ignored: Exception) {
            }
        }
    }

    @ReactMethod
    fun getMediaMeta(filePaths: ReadableArray, promise: Promise) {
        val metas = Arguments.createArray()
        for (i in 0 until filePaths.size()) {
            var mmr: MediaMetadataRetriever? = null
            try {
                val filePath = filePaths.getString(i) ?: ""
                if (!shouldUseMediaMetadataRetriever(filePath)) {
                    metas.pushNull()
                    continue
                }
                val uri = Uri.parse(filePath)

                val retriever = MediaMetadataRetriever()
                mmr = retriever
                if (isContentUri(uri)) {
                    retriever.setDataSource(reactApplicationContext, uri)
                } else {
                    retriever.setDataSource(filePath)
                }

                metas.pushMap(extractBasicMeta(retriever))
            } catch (e: Exception) {
                metas.pushNull()
            } finally {
                try {
                    mmr?.release()
                } catch (ignored: Exception) {
                }
            }
        }
        promise.resolve(metas)
    }


    @ReactMethod
    fun getMediaCoverImg(filePath: String, promise: Promise) {
        if (!shouldUseMediaMetadataRetriever(filePath)) {
            promise.resolve(null)
            return
        }

        var mmr: MediaMetadataRetriever? = null
        try {
            val uri = Uri.parse(filePath)
            val isContentUri = isContentUri(uri)
            val localPath = if (uri.scheme?.equals("file", ignoreCase = true) == true) {
                uri.path ?: filePath
            } else {
                filePath
            }
            if (!isContentUri && !File(localPath).exists()) {
                promise.reject("File not exist", "File not exist")
                return
            }

            val cacheDir = reactContext.cacheDir
            val coverCacheDir = File(cacheDir, "image_manager_disk_cache")
            if (!coverCacheDir.exists() && !coverCacheDir.mkdirs()) {
                promise.reject("Error", "Failed to create cover cache directory")
                return
            }
            val coverFile = File(coverCacheDir, "${stableCacheKey(filePath)}.jpg")
            if (coverFile.exists()) {
                promise.resolve(coverFile.toURI().toString())
                return
            }

            mmr = MediaMetadataRetriever()
            if (isContentUri) {
                mmr.setDataSource(reactApplicationContext, uri)
            } else {
                mmr.setDataSource(localPath)
            }
            val coverImg = mmr.embeddedPicture
            if (coverImg != null) {
                val bitmap = decodeCoverBitmapBounded(coverImg)
                if (bitmap == null) {
                    promise.resolve(null)
                    return
                }
                FileOutputStream(coverFile).use { outputStream ->
                    try {
                        check(bitmap.compress(Bitmap.CompressFormat.JPEG, 100, outputStream)) {
                            "Failed to compress cover bitmap"
                        }
                        outputStream.flush()
                    } finally {
                        bitmap.recycle()
                    }
                }
                promise.resolve(coverFile.toURI().toString())
            } else {
                promise.resolve(null)
            }
        } catch (ignored: Exception) {
            promise.reject("Error", "Got error")
        } finally {
            try {
                mmr?.release()
            } catch (ignored: Exception) {
            }
        }
    }

    @ReactMethod
    fun getLyric(filePath: String, promise: Promise) {
        try {
            val file = File(filePath)
            if (file.exists()) {
                val audioFile = AudioFileIO.read(file)
                val tag = audioFile.tag
                val lrc = tag.getFirst(FieldKey.LYRICS)
                promise.resolve(lrc)
            } else {
                throw IOException("File not found")
            }
        } catch (e: Exception) {
            promise.reject("Error", e.message)
        }
    }

    @ReactMethod
    fun setMediaTag(filePath: String, meta: ReadableMap, promise: Promise) {
        val metaCopy = Arguments.makeNativeMap(meta.toHashMap())
        metadataExecutor.execute {
            setMediaTagInternal(filePath, metaCopy, promise)
        }
    }

    private fun setMediaTagInternal(filePath: String, meta: ReadableMap, promise: Promise) {
        try {
            val file = File(filePath)
            if (file.exists()) {
                val audioFile = AudioFileIO.read(file)
                var tag = audioFile.tag
                if (tag == null) {
                    tag = audioFile.createDefaultTag()
                    audioFile.tag = tag
                }
                applyMediaTagFields(tag, meta)
                audioFile.commit()
                promise.resolve(true)
            } else {
                promise.reject("Error", "File Not Exist")
            }
        } catch (e: Exception) {
            promise.reject("Error", e.message)
        }
    }

    @ReactMethod
    fun getMediaTag(filePath: String, promise: Promise) {
        try {
            val file = File(filePath)
            if (file.exists()) {
                val audioFile = AudioFileIO.read(file)
                val tag = audioFile.tag ?: audioFile.createDefaultTag()

                val properties = Arguments.createMap().apply {
                    putString("title", tag.getFirst(FieldKey.TITLE))
                    putString("artist", tag.getFirst(FieldKey.ARTIST))
                    putString("album", tag.getFirst(FieldKey.ALBUM))
                    putString("lyric", tag.getFirst(FieldKey.LYRICS))
                    putString("comment", tag.getFirst(FieldKey.COMMENT))
                    putString("albumArtist", tag.getFirst(FieldKey.ALBUM_ARTIST))
                    putString("composer", tag.getFirst(FieldKey.COMPOSER))
                    putString("year", tag.getFirst(FieldKey.YEAR))
                    putString("genre", tag.getFirst(FieldKey.GENRE))
                    putString("trackNumber", tag.getFirst(FieldKey.TRACK))
                    putString("totalTracks", tag.getFirst(FieldKey.TRACK_TOTAL))
                    putString("discNumber", tag.getFirst(FieldKey.DISC_NO))
                    putString("totalDiscs", tag.getFirst(FieldKey.DISC_TOTAL))
                    putString("isrc", tag.getFirst(FieldKey.ISRC))
                    putString("language", tag.getFirst(FieldKey.LANGUAGE))
                    putString("encoder", tag.getFirst(FieldKey.ENCODER))
                    putString("bpm", tag.getFirst(FieldKey.BPM))
                    putString("mood", tag.getFirst(FieldKey.MOOD))
                    putString("rating", tag.getFirst(FieldKey.RATING))
                    putString("publisher", tag.getFirst(FieldKey.RECORD_LABEL))
                    putString("originalArtist", tag.getFirst(FieldKey.ORIGINAL_ARTIST))
                    putString("originalAlbum", tag.getFirst(FieldKey.ORIGINAL_ALBUM))
                    putString("originalYear", tag.getFirst(FieldKey.ORIGINAL_YEAR))
                    putString("url", tag.getFirst(FieldKey.URL_OFFICIAL_RELEASE_SITE))
                    val compilationValue = tag.getFirst(FieldKey.IS_COMPILATION)
                    putBoolean("compilation", compilationValue == "1" || compilationValue?.lowercase() == "true")
                }
                promise.resolve(properties)
            } else {
                promise.reject("Error", "File Not Found")
            }
        } catch (e: Exception) {
            promise.reject("Error", e.message)
        }
    }

    @ReactMethod
    fun setMediaCover(filePath: String, coverPath: String, promise: Promise) {
        metadataExecutor.execute {
            setMediaCoverInternal(filePath, coverPath, promise)
        }
    }

    private fun setMediaCoverInternal(filePath: String, coverPath: String, promise: Promise) {
        try {
            val file = File(filePath)
            if (!file.exists()) {
                promise.reject("Error", "Music file not found")
                return
            }

            val coverBytes = readCoverBytes(coverPath)
            if (coverBytes == null || coverBytes.isEmpty()) {
                promise.reject("Error", "Failed to read cover image")
                return
            }

            if (file.extension.equals("ogg", ignoreCase = true)) {
                if (setCoverForOgg(filePath, coverBytes)) {
                    promise.resolve(true)
                } else {
                    promise.reject("Error", "Failed to set cover art for OGG file")
                }
                return
            }

            val audioFile = AudioFileIO.read(file)
            var tag = audioFile.tag
            if (tag == null) {
                tag = audioFile.createDefaultTag()
                audioFile.tag = tag
            }

            tag.deleteArtworkField()
            val success = setCoverArtImageIOFree(tag, coverBytes, file.extension.lowercase())
            if (success) {
                audioFile.commit()
                promise.resolve(true)
            } else {
                promise.reject("Error", "Failed to set cover art for this file format")
            }
        } catch (e: Exception) {
            promise.reject("Error", "Failed to set cover: ${e.message}")
        }
    }

    @ReactMethod
    fun setMediaTagWithCover(filePath: String, meta: ReadableMap, coverPath: String?, promise: Promise) {
        val metaCopy = Arguments.makeNativeMap(meta.toHashMap())
        metadataExecutor.execute {
            setMediaTagWithCoverInternal(filePath, metaCopy, coverPath, promise)
        }
    }

    private fun setMediaTagWithCoverInternal(
        filePath: String,
        meta: ReadableMap,
        coverPath: String?,
        promise: Promise,
    ) {
        try {
            val file = File(filePath)
            if (!file.exists()) {
                promise.reject("Error", "File Not Exist")
                return
            }

            val audioFile = AudioFileIO.read(file)
            var tag = audioFile.tag
            if (tag == null) {
                tag = audioFile.createDefaultTag()
                audioFile.tag = tag
            }

            applyMediaTagFields(tag, meta)

            var shouldVerifyMp4Cover = false
            if (!coverPath.isNullOrEmpty()) {
                val coverBytes = readCoverBytes(coverPath)
                if (coverBytes != null && coverBytes.isNotEmpty()) {
                    if (file.extension.equals("ogg", ignoreCase = true)) {
                        audioFile.commit()
                        if (!setCoverForOgg(filePath, coverBytes)) {
                            android.util.Log.w("Mp3UtilModule", "Failed to set OGG cover; text metadata was written")
                        }
                        promise.resolve(true)
                        return
                    }

                    tag.deleteArtworkField()
                    val extension = file.extension.lowercase()
                    if (!setCoverArtImageIOFree(tag, coverBytes, extension)) {
                        throw IllegalStateException("Failed to set cover art for this file format")
                    }
                    shouldVerifyMp4Cover = extension == "m4a" || extension == "mp4"
                }
            }

            audioFile.commit()
            if (shouldVerifyMp4Cover) {
                val writtenTag = AudioFileIO.read(file).tag
                    ?: throw IllegalStateException("M4A/MP4 tag verification failed")
                check(writtenTag.artworkList.isNotEmpty()) {
                    "M4A/MP4 cover verification failed"
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Error", e.message)
        }
    }

    override fun invalidate() {
        metadataExecutor.shutdownNow()
        coverHttpClient.dispatcher.cancelAll()
        super.invalidate()
    }
}
