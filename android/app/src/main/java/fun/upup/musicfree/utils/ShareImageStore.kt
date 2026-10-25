package `fun`.upup.musicfree.utils

import android.content.ContentValues
import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64

/** Android 14 floor: save our generated PNG through MediaStore without storage permissions. */
internal object ShareImageStore {
    fun save(context: Context, encoded: String): Uri {
        require(encoded.length in 1..(12 * 1024 * 1024)) { "Image is too large" }
        val data = Base64.decode(encoded, Base64.DEFAULT)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        require(bounds.outMimeType == "image/png" && bounds.outWidth in 1..4096 &&
            bounds.outHeight in 1..4096) { "Expected a bounded PNG image" }
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "MusicFree-${System.currentTimeMillis()}.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/MusicFree")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = requireNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
        try {
            requireNotNull(resolver.openOutputStream(uri)).use { it.write(data) }
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            check(resolver.update(uri, values, null, null) == 1) { "Image was not published" }
            return uri
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
    }
}
