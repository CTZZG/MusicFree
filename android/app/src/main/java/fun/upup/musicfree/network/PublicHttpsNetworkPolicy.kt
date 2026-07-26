package `fun`.upup.musicfree.network

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

object PublicHttpsNetworkPolicy {
    private const val DEFAULT_MAX_REDIRECTS = 3
    private val redirectStatusCodes = setOf(301, 302, 303, 307, 308)

    private val publicDns = createPublicDns(Dns.SYSTEM)

    private fun createPublicDns(delegate: Dns): Dns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            if (isBlockedHostname(hostname)) {
                throw UnknownHostException("Blocked non-public host")
            }
            val addresses = delegate.lookup(hostname)
            if (addresses.isEmpty() || addresses.any(::isBlockedAddress)) {
                throw UnknownHostException("Blocked non-public address")
            }
            return addresses
        }
    }

    internal fun publicDnsForTesting(delegate: Dns): Dns =
        createPublicDns(delegate)

    internal fun redirectInterceptorForTesting(
        maxRedirects: Int = DEFAULT_MAX_REDIRECTS,
    ): Interceptor =
        SameOriginRedirectInterceptor(
            maxRedirects.coerceIn(0, DEFAULT_MAX_REDIRECTS),
        )

    fun clientBuilder(
        maxRedirects: Int = DEFAULT_MAX_REDIRECTS,
    ): OkHttpClient.Builder =
        OkHttpClient.Builder()
            .dns(publicDns)
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(redirectInterceptorForTesting(maxRedirects))

    /**
     * Enforces only what this layer is genuinely responsible for: the connection
     * may reach a public address, and the URL carries no credentials.
     *
     * Scheme is deliberately NOT enforced. Cleartext is a user-level decision
     * (basic.allowPluginInsecureHttp) checked in JS. Forcing HTTPS here silently
     * broke downloads, CENC playback and cover-art embedding for the many
     * real-world sources that still serve over http://.
     */
    fun requirePublicRemote(rawUrl: String): HttpUrl {
        val url = rawUrl.toHttpUrlOrNull()
            ?: throw IllegalArgumentException("Invalid remote URL")
        requirePublicRemote(url)
        return url
    }

    private fun requirePublicRemote(url: HttpUrl) {
        require(url.scheme == "https" || url.scheme == "http") {
            "Only HTTP or HTTPS remote URLs are allowed"
        }
        require(url.username.isEmpty() && url.password.isEmpty()) {
            "Remote URL credentials are not allowed"
        }
        require(!isBlockedHostname(url.host)) {
            "Local, private, and reserved remote hosts are not allowed"
        }
    }

    private fun isBlockedHostname(hostname: String): Boolean {
        val normalized = hostname.lowercase().trimEnd('.')
        return normalized.isEmpty() ||
            normalized == "localhost" ||
            normalized.endsWith(".localhost") ||
            normalized.endsWith(".local")
    }

    private fun isBlockedAddress(address: InetAddress): Boolean {
        if (
            address.isAnyLocalAddress ||
            address.isLoopbackAddress ||
            address.isLinkLocalAddress ||
            address.isSiteLocalAddress ||
            address.isMulticastAddress
        ) {
            return true
        }

        val bytes = address.address.map { it.toInt() and 0xff }
        return when (bytes.size) {
            4 -> isBlockedIpv4(bytes)
            16 -> isBlockedIpv6(bytes)
            else -> true
        }
    }

    private fun isBlockedIpv4(bytes: List<Int>): Boolean {
        val (a, b, c) = bytes
        return a == 0 ||
            a == 10 ||
            a == 127 ||
            (a == 100 && b in 64..127) ||
            (a == 169 && b == 254) ||
            (a == 172 && b in 16..31) ||
            (a == 192 && b == 0 && c == 0) ||
            (a == 192 && b == 0 && c == 2) ||
            (a == 192 && b == 88 && c == 99) ||
            (a == 192 && b == 168) ||
            (a == 198 && b in 18..19) ||
            (a == 198 && b == 51 && c == 100) ||
            (a == 203 && b == 0 && c == 113) ||
            a >= 224
    }

    private fun isBlockedIpv6(bytes: List<Int>): Boolean {
        val allZero = bytes.all { it == 0 }
        val loopback = bytes.take(15).all { it == 0 } && bytes[15] == 1
        val uniqueLocal = bytes[0] in 0xfc..0xfd
        val linkLocal = bytes[0] == 0xfe && bytes[1] in 0x80..0xbf
        val siteLocal = bytes[0] == 0xfe && bytes[1] in 0xc0..0xff
        val multicast = bytes[0] == 0xff
        val documentation =
            bytes[0] == 0x20 && bytes[1] == 0x01 &&
                bytes[2] == 0x0d && bytes[3] == 0xb8
        val discardOnly =
            bytes[0] == 0x01 && bytes.drop(1).all { it == 0 }
        val ipv4Mapped =
            bytes.take(10).all { it == 0 } &&
                bytes[10] == 0xff && bytes[11] == 0xff
        val mappedBlocked = ipv4Mapped && isBlockedIpv4(bytes.drop(12))
        return allZero || loopback || uniqueLocal || linkLocal || siteLocal ||
            multicast || documentation || discardOnly || mappedBlocked
    }

    private class SameOriginRedirectInterceptor(
        private val maxRedirects: Int,
    ) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            var request = chain.request()
            requirePublicRemote(request.url)
            val originalUrl = request.url
            var redirectCount = 0

            while (true) {
                val response = chain.proceed(request)
                if (response.code !in redirectStatusCodes) {
                    return response
                }
                if (redirectCount >= maxRedirects) {
                    response.close()
                    throw IllegalStateException("Remote redirect limit exceeded")
                }
                val location = response.header("Location")
                val nextUrl = location?.let(request.url::resolve)
                if (nextUrl == null) {
                    response.close()
                    throw IllegalStateException("Remote redirect URL is invalid")
                }
                try {
                    requirePublicRemote(nextUrl)
                    require(nextUrl.isSameOriginOrUpgradeOf(originalUrl)) {
                        "Only same-origin redirects (or an http->https upgrade) are allowed"
                    }
                } catch (error: Throwable) {
                    response.close()
                    throw error
                }
                response.close()
                request = request.newBuilder().url(nextUrl).build()
                redirectCount += 1
            }
        }
    }

    /**
     * Same origin, or the same host upgrading http -> https.
     *
     * Comparing full origins would reject the very common pattern of an http://
     * media/download URL answering with a redirect to https://. A TLS upgrade on
     * the identical host is strictly safer, so it is allowed; downgrades and any
     * host change are still refused. HttpUrl.port reports the scheme default
     * when none was given, so 80 -> 443 is the same implicit port.
     */
    private fun HttpUrl.isSameOriginOrUpgradeOf(original: HttpUrl): Boolean {
        if (host != original.host) {
            return false
        }
        if (scheme == original.scheme) {
            return port == original.port
        }
        if (original.scheme != "http" || scheme != "https") {
            return false
        }
        return (original.port == 80 && port == 443) || port == original.port
    }
}
