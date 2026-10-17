package `fun`.upup.musicfree.lyricUtil

/** The desktop lyric window cannot be added because the app may not draw over other apps. */
internal class OverlayPermissionException(cause: Throwable? = null) :
    Exception("Overlay permission is not granted", cause)

/** Promise rejection codes. JS only blames the overlay permission for OVERLAY_PERMISSION. */
internal object LyricErrors {
    const val OVERLAY_PERMISSION = "OVERLAY_PERMISSION"
    const val GENERIC = "Exception"

    fun code(error: Exception): String =
        if (error is OverlayPermissionException) OVERLAY_PERMISSION else GENERIC
}
