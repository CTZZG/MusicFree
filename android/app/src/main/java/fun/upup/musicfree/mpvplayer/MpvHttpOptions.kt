package `fun`.upup.musicfree.mpvplayer

import `fun`.upup.musicfree.network.PublicHttpsNetworkPolicy
import java.net.InetAddress
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal object MpvHttpOptions {
    private val forbiddenHeaders = setOf(
        "host",
        "connection",
        "content-length",
        "transfer-encoding",
        "proxy-authorization",
    )

    private val ipv4Literal = Regex("""^\d{1,3}(?:\.\d{1,3}){3}$""")
    private val explicitLoopbackProxyRegex = Regex(
        pattern = """^http://(?:127\.0\.0\.1|localhost):(\d+)(?:[/?#]|$)""",
        option = RegexOption.IGNORE_CASE,
    )

    fun sanitizeSingleLine(value: String): String =
        value.replace("\r", "").replace("\n", "").replace("\u0000", "").trim()

    fun encodeLengthPrefixed(value: String): String {
        val utf8Bytes = value.toByteArray(Charsets.UTF_8)
        return "%${utf8Bytes.size}%$value"
    }

    fun encodeHeaderFieldsOption(headers: Map<String, String?>?): String {
        if (headers.isNullOrEmpty()) {
            return ""
        }
        val items = mutableListOf<String>()
        for ((rawKey, rawValue) in headers) {
            if (rawValue == null) continue
            val key = sanitizeSingleLine(rawKey)
            if (key.isEmpty() || key.any { it == ':' || it.isWhitespace() }) {
                continue
            }
            if (key.lowercase() in forbiddenHeaders) {
                continue
            }
            val value = sanitizeSingleLine(rawValue)
            items += encodeLengthPrefixed("$key: $value")
        }
        return items.joinToString(",")
    }

    fun buildLoadFileOptions(headerFieldsList: String, userAgent: String?): String {
        val parts = mutableListOf(
            "http-header-fields=${encodeLengthPrefixed(headerFieldsList)}",
        )
        val cleanUa = userAgent?.let(::sanitizeSingleLine)?.takeIf { it.isNotEmpty() }
        if (cleanUa != null) {
            parts += "user-agent=${encodeLengthPrefixed(cleanUa)}"
        }
        return parts.joinToString(",")
    }

    fun buildLoadFileCommand(
        url: String,
        mode: String,
        headerFieldsList: String,
        userAgent: String?,
    ): Array<String> = arrayOf(
        "loadfile",
        url,
        mode,
        "-1",
        buildLoadFileOptions(headerFieldsList, userAgent),
    )

    fun validateMediaUrl(
        rawUrl: String,
        renditionKind: String,
        trustedLocalProxy: Boolean,
        allowInsecureHttpExplicit: Boolean?,
    ) {
        require(rawUrl.isNotBlank()) { "Media URL is blank" }
        require(rawUrl.none { it == '\r' || it == '\n' || it == '\u0000' }) {
            "Media URL contains forbidden control characters"
        }
        if (rawUrl.startsWith("/")) {
            return
        }
        val colonIndex = rawUrl.indexOf(':')
        require(colonIndex > 0) { "Invalid media URL" }
        val scheme = rawUrl.substring(0, colonIndex).lowercase()
        if (scheme == "file" || scheme == "content") {
            require(rawUrl.length > colonIndex + 1) { "Invalid local media URI" }
            return
        }
        require(scheme == "http" || scheme == "https") {
            "Unsupported media URL scheme: $scheme"
        }

        val httpUrl = rawUrl.toHttpUrlOrNull()
            ?: throw IllegalArgumentException("Invalid remote media URL")
        require(httpUrl.username.isEmpty() && httpUrl.password.isEmpty()) {
            "Media URL credentials are not allowed"
        }

        val host = httpUrl.host.lowercase().trimEnd('.')
        if (isLoopbackOrUnspecifiedHost(host)) {
            val match = explicitLoopbackProxyRegex.find(rawUrl)
            val allowedProxy =
                trustedLocalProxy &&
                    renditionKind == "audio" &&
                    httpUrl.scheme == "http" &&
                    match != null &&
                    httpUrl.port in 1..65535
            require(allowedProxy) { "Loopback media URL is not allowed" }
            return
        }

        if (renditionKind == "mv") {
            PublicHttpsNetworkPolicy.requirePublicRemote(rawUrl)
            require(httpUrl.scheme != "http" || allowInsecureHttpExplicit == true) {
                "Insecure HTTP MV playback is not allowed"
            }
        } else {
            require(httpUrl.scheme != "http" || allowInsecureHttpExplicit != false) {
                "Insecure HTTP audio playback is not allowed"
            }
        }
    }

    private fun isLoopbackOrUnspecifiedHost(host: String): Boolean {
        if (host.isEmpty() || host == "localhost" || host.endsWith(".localhost")) {
            return true
        }
        if (ipv4Literal.matches(host)) {
            val octets = host.split('.').mapNotNull { it.toIntOrNull() }
            if (octets.size != 4 || octets.any { it !in 0..255 }) {
                return true
            }
            return octets[0] == 127 || octets[0] == 0
        }
        if (':' !in host) {
            return false
        }
        val address = try {
            InetAddress.getByName(host.removePrefix("[").removeSuffix("]"))
        } catch (_: Exception) {
            return true
        }
        if (address.isLoopbackAddress || address.isAnyLocalAddress) {
            return true
        }
        val bytes = address.address.map { it.toInt() and 0xff }
        if (bytes.size == 16) {
            val ipv4Mapped =
                bytes.take(10).all { it == 0 } &&
                    bytes[10] == 0xff &&
                    bytes[11] == 0xff
            if (ipv4Mapped) {
                return bytes[12] == 127 || bytes[12] == 0
            }
        }
        return false
    }
}
