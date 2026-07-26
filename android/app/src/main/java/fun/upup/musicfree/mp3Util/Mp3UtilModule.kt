package `fun`.upup.musicfree.mp3Util

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import com.facebook.react.bridge.*
import `fun`.upup.musicfree.bridge.CancelablePromise
import `fun`.upup.musicfree.network.PublicHttpsNetworkPolicy
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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

class Mp3UtilModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "Mp3Util"

    private val maxCoverBytes = 20 * 1024 * 1024
    private val maxCoverBitmapSide = 1024
    private val metadataExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "MusicFree-Metadata").apply { isDaemon = true }
    }
    private val invalidated = AtomicBoolean(false)
    private val activePromises =
        ConcurrentHashMap.newKeySet<CancelablePromise>()
    private val coverHttpClient = PublicHttpsNetworkPolicy.clientBuilder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private inner class PendingMetadataTask(
        private val promise: CancelablePromise,
        private val action: () -> Unit,
    ) : Runnable {
        override fun run() {
            if (invalidated.get()) {
                promise.cancel()
                return
            }
            try {
                action()
            } catch (error: Throwable) {
                promise.reject(
                    "E_METADATA_UNEXPECTED",
                    "Metadata operation failed unexpectedly",
                    error,
                )
            }
        }

        fun rejectCancelled() {
            promise.cancel()
        }
    }

    private fun controlledPromise(promise: Promise): CancelablePromise {
        val controlled = CancelablePromise(
            promise,
            "E_METADATA_CANCELLED",
            "Metadata operation was cancelled",
        ) {
            activePromises.remove(it)
        }
        activePromises.add(controlled)
        if (invalidated.get()) {
            controlled.cancel()
        }
        return controlled
    }

    private fun executeMetadata(
        promise: Promise,
        action: (Promise) -> Unit,
    ) {
        val controlled = controlledPromise(promise)
        if (invalidated.get()) {
            controlled.cancel()
            return
        }
        val task = PendingMetadataTask(controlled) {
            action(controlled)
        }
        try {
            metadataExecutor.execute(task)
        } catch (_: RejectedExecutionException) {
            task.rejectCancelled()
        }
    }

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
        val parsed = Uri.parse(filePath)
        val resolvedPath = if (isContentUri(parsed)) {
            getContentDisplayName(parsed) ?: filePath
        } else {
            filePath
        }
        val pathWithoutQuery = resolvedPath.substringBefore("?")
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

    private fun toLocalFile(filePath: String): File? {
        val uri = Uri.parse(filePath)
        val path = if (uri.scheme?.equals("file", ignoreCase = true) == true) {
            uri.path ?: filePath
        } else {
            filePath
        }
        val file = File(path)
        return if (file.exists()) file else null
    }

    private fun getContentDisplayName(uri: Uri): String? {
        return try {
            reactApplicationContext.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                val index = cursor.getColumnIndex(
                    OpenableColumns.DISPLAY_NAME,
                )
                if (index >= 0 && cursor.moveToFirst() && !cursor.isNull(index)) {
                    cursor.getString(index)
                } else {
                    null
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun contentFileExtension(uri: Uri): String {
        val nameExtension = getContentDisplayName(uri)
            ?.substringAfterLast('.', "")
            ?.lowercase(Locale.ROOT)
            ?.takeIf { it.matches(Regex("[a-z0-9]{1,10}")) }
        if (nameExtension != null) {
            return ".$nameExtension"
        }
        return when (
            reactApplicationContext.contentResolver.getType(uri)
                ?.lowercase(Locale.ROOT)
        ) {
            "audio/mpeg", "audio/mp3" -> ".mp3"
            "audio/flac", "audio/x-flac" -> ".flac"
            "audio/mp4", "audio/m4a", "audio/x-m4a" -> ".m4a"
            "audio/wav", "audio/x-wav", "audio/wave" -> ".wav"
            "audio/ogg", "application/ogg" -> ".ogg"
            "audio/aac" -> ".aac"
            "audio/x-ms-wma" -> ".wma"
            else -> ".audio"
        }
    }

    private fun materializeContentUri(
        uri: Uri,
        prefix: String,
    ): File {
        val temporary = File.createTempFile(
            prefix,
            contentFileExtension(uri),
            reactApplicationContext.cacheDir,
        )
        try {
            reactApplicationContext.contentResolver.openInputStream(uri)
                ?.use { input ->
                    temporary.outputStream().use { output ->
                        input.copyTo(output)
                        output.fd.sync()
                    }
                }
                ?: throw IOException("Unable to open content URI")
            return temporary
        } catch (error: Exception) {
            temporary.delete()
            throw error
        }
    }

    private fun <T> withReadableLocalFile(
        filePath: String,
        action: (File) -> T,
    ): T {
        val uri = Uri.parse(filePath)
        if (!isContentUri(uri)) {
            val file = toLocalFile(filePath)
                ?: throw IOException("File not found")
            return action(file)
        }
        val temporary = materializeContentUri(uri, "metadata-read-")
        return try {
            action(temporary)
        } finally {
            temporary.delete()
        }
    }

    private fun sha256(file: File): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest()
    }

    private fun contentSha256(uri: Uri): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        reactApplicationContext.contentResolver.openInputStream(uri)
            ?.use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
            }
            ?: throw IOException("Unable to verify content URI")
        return digest.digest()
    }

    private fun writeFileToContentUri(
        uri: Uri,
        source: File,
        onOpened: () -> Unit,
    ) {
        // Deliberately "rw" rather than "rwt": O_TRUNC would empty the user's
        // file at open, so a crash or process death part-way through the copy
        // would destroy it before the caller's rollback could run. Opening
        // without truncation keeps the old bytes in place until the new
        // content has been written, and the file is only shortened afterwards.
        // "rw" is also supported by more document providers than "rwt".
        val descriptor = reactApplicationContext.contentResolver
            .openFileDescriptor(uri, "rw")
            ?: throw IOException("Unable to open content URI for writing")
        onOpened()
        ParcelFileDescriptor.AutoCloseOutputStream(descriptor).use { output ->
            val channel = output.channel
            channel.position(0)
            source.inputStream().use { input ->
                input.copyTo(output)
            }
            output.flush()
            channel.truncate(channel.position())
            output.fd.sync()
        }
    }

    private fun <T> withWritableLocalFile(
        filePath: String,
        action: (File) -> T,
    ): T {
        val uri = Uri.parse(filePath)
        if (!isContentUri(uri)) {
            val file = toLocalFile(filePath)
                ?: throw IOException("File not found")
            return action(file)
        }

        val original = materializeContentUri(uri, "metadata-original-")
        val working = File.createTempFile(
            "metadata-working-",
            contentFileExtension(uri),
            reactApplicationContext.cacheDir,
        )
        try {
            original.copyTo(working, overwrite = true)
            val result = action(working)
            val expectedDigest = sha256(working)
            var destinationOpened = false
            try {
                writeFileToContentUri(uri, working) {
                    destinationOpened = true
                }
                check(contentSha256(uri).contentEquals(expectedDigest)) {
                    "Content URI write verification failed"
                }
            } catch (commitError: Exception) {
                if (destinationOpened) {
                    try {
                        val originalDigest = sha256(original)
                        writeFileToContentUri(uri, original) {}
                        check(
                            contentSha256(uri).contentEquals(originalDigest),
                        ) {
                            "Content URI rollback verification failed"
                        }
                    } catch (rollbackError: Exception) {
                        val failure = IOException(
                            "Content URI write failed and rollback failed",
                            rollbackError,
                        )
                        failure.addSuppressed(commitError)
                        throw failure
                    }
                }
                throw commitError
            }
            return result
        } finally {
            working.delete()
            original.delete()
        }
    }

    /**
     * MediaMetadataRetriever 对部分格式（ape/asf/dff/dsf/wma）会崩溃或挂起，
     * 这些格式改用 jaudiotagger 读取标签。jaudiotagger 2.2.5 支持 asf/wma/dsf；
     * ape/dff 不支持，返回 null 由上层按无标签处理。
     */
    private fun extractMetaWithTagLib(filePath: String): WritableMap? {
        return try {
            withReadableLocalFile(filePath) { file ->
                val audioFile = AudioFileIO.read(file)
                val tag = audioFile.tag
                val header = audioFile.audioHeader
                Arguments.createMap().apply {
                    header?.trackLength?.let { seconds ->
                        // 与 MediaMetadataRetriever 保持一致，duration 为毫秒字符串
                        putString("duration", (seconds.toLong() * 1000L).toString())
                    }
                    header?.bitRate?.let { putString("bitrate", it) }
                    tag?.getFirst(FieldKey.ARTIST)?.takeIf { it.isNotEmpty() }?.let { putString("artist", it) }
                    tag?.getFirst(FieldKey.ALBUM)?.takeIf { it.isNotEmpty() }?.let { putString("album", it) }
                    tag?.getFirst(FieldKey.TITLE)?.takeIf { it.isNotEmpty() }?.let { putString("title", it) }
                    tag?.getFirst(FieldKey.YEAR)?.takeIf { it.isNotEmpty() }?.let { putString("year", it) }
                }
            }
        } catch (ignored: Exception) {
            null
        }
    }

    private fun extractArtworkWithTagLib(filePath: String): ByteArray? {
        return try {
            withReadableLocalFile(filePath) { file ->
                AudioFileIO.read(file).tag?.firstArtwork?.binaryData
            }
        } catch (ignored: Exception) {
            null
        }
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
            PublicHttpsNetworkPolicy.requirePublicRemote(imageUrl)
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
            coverPath.startsWith("content://") -> {
                try {
                    reactApplicationContext.contentResolver
                        .openInputStream(Uri.parse(coverPath))
                        ?.use { input ->
                            val output = ByteArrayOutputStream()
                            val buffer = ByteArray(32 * 1024)
                            var total = 0
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                total += count
                                if (total > maxCoverBytes) {
                                    return null
                                }
                                output.write(buffer, 0, count)
                            }
                            output.toByteArray()
                        }
                } catch (_: Exception) {
                    null
                }
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
            promise.resolve(extractMetaWithTagLib(filePath) ?: Arguments.createMap())
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
                    val fallbackMeta = extractMetaWithTagLib(filePath)
                    if (fallbackMeta != null) {
                        metas.pushMap(fallbackMeta)
                    } else {
                        metas.pushNull()
                    }
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

            val coverImg: ByteArray? = if (!shouldUseMediaMetadataRetriever(filePath)) {
                // MediaMetadataRetriever 对这些格式不安全，用 jaudiotagger 取内嵌封面
                extractArtworkWithTagLib(filePath)
            } else {
                mmr = MediaMetadataRetriever()
                if (isContentUri) {
                    mmr.setDataSource(reactApplicationContext, uri)
                } else {
                    mmr.setDataSource(localPath)
                }
                mmr.embeddedPicture
            }
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
        executeMetadata(promise) { operationPromise ->
            try {
                val lrc = withReadableLocalFile(filePath) { file ->
                    AudioFileIO.read(file).tag?.getFirst(FieldKey.LYRICS)
                }
                operationPromise.resolve(lrc)
            } catch (e: Exception) {
                operationPromise.reject(
                    "Error",
                    "Unable to read embedded lyrics",
                )
            }
        }
    }

    @ReactMethod
    fun setMediaTag(filePath: String, meta: ReadableMap, promise: Promise) {
        val metaCopy = Arguments.makeNativeMap(meta.toHashMap())
        executeMetadata(promise) { operationPromise ->
            setMediaTagInternal(filePath, metaCopy, operationPromise)
        }
    }

    private fun setMediaTagInternal(filePath: String, meta: ReadableMap, promise: Promise) {
        try {
            withWritableLocalFile(filePath) { file ->
                val audioFile = AudioFileIO.read(file)
                var tag = audioFile.tag
                if (tag == null) {
                    tag = audioFile.createDefaultTag()
                    audioFile.tag = tag
                }
                applyMediaTagFields(tag, meta)
                audioFile.commit()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            android.util.Log.e("Mp3UtilModule", "Failed to set media tag", e)
            promise.reject("Error", "Failed to set media tag", e)
        }
    }

    @ReactMethod
    fun getMediaTag(filePath: String, promise: Promise) {
        executeMetadata(promise) { operationPromise ->
            try {
                val properties = withReadableLocalFile(filePath) { file ->
                val audioFile = AudioFileIO.read(file)
                val tag = audioFile.tag ?: audioFile.createDefaultTag()

                    Arguments.createMap().apply {
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
                }
                operationPromise.resolve(properties)
            } catch (_: Exception) {
                operationPromise.reject("Error", "Unable to read media tags")
            }
        }
    }

    @ReactMethod
    fun setMediaCover(filePath: String, coverPath: String, promise: Promise) {
        executeMetadata(promise) { operationPromise ->
            setMediaCoverInternal(filePath, coverPath, operationPromise)
        }
    }

    private fun setMediaCoverInternal(filePath: String, coverPath: String, promise: Promise) {
        try {
            val coverBytes = readCoverBytes(coverPath)
            if (coverBytes == null || coverBytes.isEmpty()) {
                promise.reject("Error", "Failed to read cover image")
                return
            }

            withWritableLocalFile(filePath) { file ->
                if (file.extension.equals("ogg", ignoreCase = true)) {
                    check(setCoverForOgg(file.path, coverBytes)) {
                        "Failed to set cover art for OGG file"
                    }
                } else {
                    val audioFile = AudioFileIO.read(file)
                    var tag = audioFile.tag
                    if (tag == null) {
                        tag = audioFile.createDefaultTag()
                        audioFile.tag = tag
                    }

                    tag.deleteArtworkField()
                    check(
                        setCoverArtImageIOFree(
                            tag,
                            coverBytes,
                            file.extension.lowercase(),
                        ),
                    ) {
                        "Failed to set cover art for this file format"
                    }
                    audioFile.commit()
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("Error", "Failed to set cover", e)
        }
    }

    @ReactMethod
    fun setMediaTagWithCover(filePath: String, meta: ReadableMap, coverPath: String?, promise: Promise) {
        val metaCopy = Arguments.makeNativeMap(meta.toHashMap())
        executeMetadata(promise) { operationPromise ->
            setMediaTagWithCoverInternal(
                filePath,
                metaCopy,
                coverPath,
                operationPromise,
            )
        }
    }

    private fun setMediaTagWithCoverInternal(
        filePath: String,
        meta: ReadableMap,
        coverPath: String?,
        promise: Promise,
    ) {
        try {
            withWritableLocalFile(filePath) { file ->
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
                            check(setCoverForOgg(file.path, coverBytes)) {
                                "Failed to set OGG cover"
                            }
                            return@withWritableLocalFile
                        }

                        tag.deleteArtworkField()
                        val extension = file.extension.lowercase()
                        check(
                            setCoverArtImageIOFree(
                                tag,
                                coverBytes,
                                extension,
                            ),
                        ) {
                            "Failed to set cover art for this file format"
                        }
                        shouldVerifyMp4Cover =
                            extension == "m4a" || extension == "mp4"
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
            }
            promise.resolve(true)
        } catch (e: Exception) {
            android.util.Log.e("Mp3UtilModule", "Failed to set media tag with cover", e)
            promise.reject("Error", "Failed to set media tag with cover", e)
        }
    }

    override fun invalidate() {
        if (!invalidated.compareAndSet(false, true)) {
            return
        }
        activePromises.toList().forEach { it.cancel() }
        metadataExecutor.shutdownNow().forEach { task ->
            if (task is PendingMetadataTask) {
                task.rejectCancelled()
            }
        }
        coverHttpClient.dispatcher.cancelAll()
        super.invalidate()
    }
}
