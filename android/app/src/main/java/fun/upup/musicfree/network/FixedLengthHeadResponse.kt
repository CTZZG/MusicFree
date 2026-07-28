package `fun`.upup.musicfree.network

import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream

internal fun fixedLengthHeadResponse(
    status: NanoHTTPD.Response.IStatus,
    mimeType: String,
    contentLength: Long,
): NanoHTTPD.Response {
    require(contentLength >= 0L) { "HEAD response length must not be negative" }
    return NanoHTTPD.newFixedLengthResponse(
        status,
        mimeType,
        ByteArrayInputStream(ByteArray(0)),
        contentLength,
    )
}
