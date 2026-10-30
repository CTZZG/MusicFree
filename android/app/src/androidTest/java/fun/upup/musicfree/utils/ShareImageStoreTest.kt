package `fun`.upup.musicfree.utils

import android.graphics.Bitmap
import android.graphics.Color
import android.Manifest
import android.content.pm.PackageManager
import android.provider.MediaStore
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ShareImageStoreTest {
    @Test
    fun savedPngIsReadableAndPublishedWithoutStoragePermission() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals(PackageManager.PERMISSION_DENIED,
            context.checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES))
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        val output = ByteArrayOutputStream()
        bitmap.eraseColor(Color.rgb(20, 70, 130))
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
        bitmap.recycle()
        val bytes = output.toByteArray()
        val uri = ShareImageStore.save(context, Base64.encodeToString(bytes, Base64.NO_WRAP))
        try {
            assertArrayEquals(bytes, context.contentResolver.openInputStream(uri)!!.use { it.readBytes() })
            context.contentResolver.query(uri, arrayOf(MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.IS_PENDING, MediaStore.Images.Media.RELATIVE_PATH), null, null, null)!!.use {
                assertTrue(it.moveToFirst())
                assertEquals("image/png", it.getString(0))
                assertEquals(0, it.getInt(1))
                assertEquals("Pictures/MusicFree/", it.getString(2))
            }
        } finally { context.contentResolver.delete(uri, null, null) }
    }

    @Test
    fun invalidPayloadCannotCreateAGalleryItem() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        fun rows() = context.contentResolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Images.Media._ID), "${MediaStore.Images.Media.RELATIVE_PATH} = ?",
            arrayOf("Pictures/MusicFree/"), null)!!.use { it.count }
        val before = rows()
        assertThrows(IllegalArgumentException::class.java) {
            ShareImageStore.save(context, Base64.encodeToString("not a PNG".toByteArray(), Base64.NO_WRAP))
        }
        assertEquals(before, rows())
    }
}
