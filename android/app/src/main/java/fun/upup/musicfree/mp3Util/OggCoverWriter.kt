package `fun`.upup.musicfree.mp3Util

import android.util.Base64
import android.util.Log
import java.io.File

/** Android image encoding and reporting around the streaming Vorbis container writer. */
object OggCoverWriter {
    fun writeCover(
        oggFilePath: String,
        coverBytes: ByteArray,
        mimeType: String,
        imageWidth: Int,
        imageHeight: Int,
        colourDepth: Int,
    ): Boolean = try {
        val picture = OggCoverRewriter.buildMetadataBlockPicture(
            coverBytes, mimeType, imageWidth, imageHeight, colourDepth,
        )
        OggCoverRewriter.writeCover(
            File(oggFilePath), Base64.encodeToString(picture, Base64.NO_WRAP),
        )
        true
    } catch (error: Exception) {
        Log.e("OggCoverWriter", "Failed to write OGG cover: ${error.message}", error)
        false
    }
}
