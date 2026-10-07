package `fun`.upup.musicfree.network

import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.net.UnknownHostException
import java.io.IOException
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

object PublicHttpsNetworkPolicy {
    private const val DEFAULT_MAX_REDIRECTS = 3
    private val redirectStatusCodes = setOf(301, 302, 303, 307, 308)
    private val ipv4Literal = Regex("""^\d{1,3}(\.\d{1,3}){3}$""")
    private val credentialHeaders = listOf("Authorization", "Cookie", "Proxy-Authorization")

    /**
     * Which redirect targets a client may follow.
     *
     * SAME_ORIGIN is the default for requests that can carry credentials or
     * plugin-supplied headers (downloads, media proxies): every header is
     * forwarded on each hop, so the host must not change.
     *
     * CROSS_ORIGIN is for credential-free display fetches such as cover art,
     * whose URLs often go through a redirector on another host. Each hop still
     * passes requirePublicRemote, every connection still goes through the
     * public-address DNS filter, https never downgrades to http, and credential
     * headers are dropped whenever the host changes.
     */
    enum class RedirectScope {
        SAME_ORIGIN,
        CROSS_ORIGIN,
    }

    /**
     * Direct destination DNS only hands public addresses to OkHttp. Non-public answers are
     * dropped rather than failing the whole lookup, so a mixed answer still
     * connects to its public addresses and never to the private ones.
     *
     * Proxy/VPN apps in fake-ip mode (Clash, sing-box, Surge, Shadowrocket...)
     * answer every query from 198.18.0.0/15 and route the connection
     * themselves. That range is not reachable on the public internet, so
     * rejecting it protects nothing; it only made every native fetch (cover
     * art for the notification and Live Update, downloads, the QMC/CENC
     * proxies) fail for those users while the JS side kept working. It is
     * accepted here as a DNS answer only; a URL that names such an IP
     * literally is still refused by [requirePublicRemote]. System HTTP proxy
     * transport endpoints are handled separately by [ProxyRouteDns].
     */
    private fun createPublicDns(delegate: Dns): Dns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            if (isBlockedHostname(hostname)) {
                throw UnknownHostException("Blocked non-public host")
            }
            val addresses = delegate.lookup(hostname).filter { address ->
                isProxyFakeIpAddress(address) || !isBlockedAddress(address)
            }
            if (addresses.isEmpty()) {
                throw UnknownHostException("Blocked non-public address")
            }
            return addresses
        }
    }

    /** 198.18.0.0/15, the default fake-ip pool of proxy/VPN apps. */
    private fun isProxyFakeIpAddress(address: InetAddress): Boolean {
        val bytes = address.address
        if (bytes.size != 4) return false
        val a = bytes[0].toInt() and 0xff
        val b = bytes[1].toInt() and 0xff
        return a == 198 && b in 18..19
    }

    internal fun publicDnsForTesting(delegate: Dns): Dns =
        createPublicDns(delegate)

    internal fun redirectInterceptorForTesting(
        maxRedirects: Int = DEFAULT_MAX_REDIRECTS,
        redirectScope: RedirectScope = RedirectScope.SAME_ORIGIN,
    ): Interceptor =
        PublicRedirectInterceptor(
            maxRedirects.coerceIn(0, DEFAULT_MAX_REDIRECTS),
            redirectScope,
        )

    fun clientBuilder(
        maxRedirects: Int = DEFAULT_MAX_REDIRECTS,
        redirectScope: RedirectScope = RedirectScope.SAME_ORIGIN,
    ): OkHttpClient.Builder = createClientBuilder(
        Dns.SYSTEM,
        ProxySelector.getDefault(),
        maxRedirects,
        redirectScope,
    )

    internal fun clientBuilderForTesting(
        dns: Dns,
        proxySelector: ProxySelector?,
        redirectScope: RedirectScope = RedirectScope.SAME_ORIGIN,
    ): OkHttpClient.Builder = createClientBuilder(
        dns,
        proxySelector,
        DEFAULT_MAX_REDIRECTS,
        redirectScope,
    )

    private fun createClientBuilder(
        dns: Dns,
        proxySelector: ProxySelector?,
        maxRedirects: Int,
        redirectScope: RedirectScope,
    ): OkHttpClient.Builder {
        val proxyRoutes = ProxyRouteDns(dns, proxySelector)
        return OkHttpClient.Builder()
            .dns(proxyRoutes.dns)
            .proxySelector(proxyRoutes.selector)
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(redirectInterceptorForTesting(maxRedirects, redirectScope))
    }

    /**
     * OkHttp uses the same Dns callback for a direct destination and an HTTP
     * proxy's socket address. Android VPN apps can select a loopback proxy;
     * that transport endpoint is not the request's remote target.
     *
     * RouteSelector selects proxies and resolves their addresses synchronously
     * on the call's thread. Keep that selection thread-local, so concurrent
     * calls and DIRECT fallbacks never inherit another request's exemption.
     * URL validation and direct destination DNS filtering remain unchanged.
     */
    private class ProxyRouteDns(
        private val delegateDns: Dns,
        private val delegateSelector: ProxySelector?,
    ) {
        private data class Routes(val targetHost: String, val proxyHosts: Set<String>)
        private val selectedRoutes = ThreadLocal<Routes>()
        private val publicDns = createPublicDns(delegateDns)

        val selector = object : ProxySelector() {
            override fun select(uri: URI): List<Proxy> {
                selectedRoutes.remove()
                val proxies = delegateSelector?.select(uri)?.takeIf { it.isNotEmpty() }
                    ?: listOf(Proxy.NO_PROXY)
                val proxyHosts = proxies.mapNotNull { proxy ->
                    if (proxy.type() != Proxy.Type.HTTP) return@mapNotNull null
                    val endpoint = proxy.address() as? InetSocketAddress
                        ?: return@mapNotNull null
                    // Match OkHttp's socketHost: a resolved proxy uses its IP;
                    // an unresolved proxy keeps the system-supplied hostname.
                    normalizeHost(endpoint.address?.hostAddress ?: endpoint.hostString)
                }.toSet()
                selectedRoutes.set(Routes(normalizeHost(uri.host.orEmpty()), proxyHosts))
                return proxies
            }

            override fun connectFailed(uri: URI, sa: SocketAddress, ioe: IOException) {
                delegateSelector?.connectFailed(uri, sa, ioe)
            }
        }

        val dns = object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                val host = normalizeHost(hostname)
                val routes = selectedRoutes.get()
                return if (
                    routes != null && host != routes.targetHost && host in routes.proxyHosts
                ) {
                    delegateDns.lookup(hostname)
                } else {
                    publicDns.lookup(hostname)
                }
            }
        }

        private fun normalizeHost(host: String) = host.lowercase().trimEnd('.')
    }

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

    /**
     * Throws unless [nextUrl] is a redirect target [scope] allows. Same-origin
     * is judged against the request's original URL, downgrades against the hop
     * that answered with the redirect.
     */
    internal fun requireAllowedRedirect(
        scope: RedirectScope,
        originalUrl: HttpUrl,
        previousUrl: HttpUrl,
        nextUrl: HttpUrl,
    ) {
        requirePublicRemote(nextUrl)
        when (scope) {
            RedirectScope.SAME_ORIGIN -> require(nextUrl.isSameOriginOrUpgradeOf(originalUrl)) {
                "Only same-origin redirects (or an http->https upgrade) are allowed"
            }
            RedirectScope.CROSS_ORIGIN -> require(nextUrl.isHttps || !previousUrl.isHttps) {
                "Redirects may not downgrade https to http"
            }
        }
    }

    private fun isBlockedHostname(hostname: String): Boolean {
        val normalized = hostname.lowercase().trimEnd('.')
        return normalized.isEmpty() ||
            normalized == "localhost" ||
            normalized.endsWith(".localhost") ||
            normalized.endsWith(".local") ||
            isBlockedIpLiteral(normalized)
    }

    /**
     * IP hosts are judged here instead of being left to the DNS filter: whether
     * OkHttp consults Dns at all for an IP host is an implementation detail, and
     * the redirect interceptor has to refuse a private target before connecting.
     */
    private fun isBlockedIpLiteral(host: String): Boolean {
        if (ipv4Literal.matches(host)) {
            val octets = host.split('.').map(String::toInt)
            return octets.any { it > 255 } || isBlockedIpv4(octets)
        }
        if (':' !in host) {
            return false
        }
        // HttpUrl only yields a ':' in a host for an IPv6 literal it has already
        // validated, so this parses the literal and never performs a DNS lookup.
        val address = try {
            InetAddress.getByName(host.removePrefix("[").removeSuffix("]"))
        } catch (_: Exception) {
            return true
        }
        return isBlockedAddress(address)
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

    private class PublicRedirectInterceptor(
        private val maxRedirects: Int,
        private val scope: RedirectScope,
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
                    requireAllowedRedirect(scope, originalUrl, request.url, nextUrl)
                } catch (error: Throwable) {
                    response.close()
                    throw error
                }
                response.close()
                val dropCredentials =
                    scope == RedirectScope.CROSS_ORIGIN &&
                        !nextUrl.isSameOriginOrUpgradeOf(request.url)
                request = request.newBuilder()
                    .url(nextUrl)
                    .apply {
                        if (dropCredentials) {
                            credentialHeaders.forEach { removeHeader(it) }
                        }
                    }
                    .build()
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
