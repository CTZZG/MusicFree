package `fun`.upup.musicfree.network

import `fun`.upup.musicfree.network.PublicHttpsNetworkPolicy.RedirectScope
import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PublicHttpsNetworkPolicyTest {
    private val servers = mutableListOf<MockWebServer>()
    // Android's getLoopbackAddress() may choose ::1 while MockWebServer's
    // default bind chooses IPv4. Bind and resolve the same fixture address.
    private val loopbackAddress = InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))

    @After
    fun tearDown() {
        servers.forEach(MockWebServer::shutdown)
    }

    @Test
    fun dnsPolicyRevalidatesEveryLookupAndRejectsAPublicToPrivateFlip() {
        val publicAddress = InetAddress.getByAddress(
            "public.test",
            byteArrayOf(93, 184.toByte(), 216.toByte(), 34),
        )
        val privateAddress = InetAddress.getByAddress(
            "public.test",
            byteArrayOf(127, 0, 0, 1),
        )
        var lookupCount = 0
        val dns = PublicHttpsNetworkPolicy.publicDnsForTesting(
            object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    lookupCount += 1
                    return if (lookupCount == 1) {
                        listOf(publicAddress)
                    } else {
                        listOf(privateAddress)
                    }
                }
            },
        )

        assertEquals(listOf(publicAddress), dns.lookup("public.test"))
        assertThrows(UnknownHostException::class.java) {
            dns.lookup("public.test")
        }
        assertEquals(2, lookupCount)
    }

    @Test
    fun dnsPolicyRejectsAnIPv4MappedIPv6LoopbackAddress() {
        val bytes = ByteArray(16)
        bytes[10] = 0xff.toByte()
        bytes[11] = 0xff.toByte()
        bytes[12] = 127
        bytes[15] = 1
        val mappedLoopback = Inet6Address.getByAddress("public.test", bytes, -1)
        val dns = PublicHttpsNetworkPolicy.publicDnsForTesting(
            object : Dns {
                override fun lookup(hostname: String): List<InetAddress> =
                    listOf(mappedLoopback)
            },
        )

        assertThrows(UnknownHostException::class.java) {
            dns.lookup("public.test")
        }
    }

    @Test
    fun dnsPolicyDropsPrivateAnswersAndKeepsThePublicOnes() {
        val publicAddress = InetAddress.getByAddress(
            "mixed.test",
            byteArrayOf(93, 184.toByte(), 216.toByte(), 34),
        )
        val privateAddress = InetAddress.getByAddress(
            "mixed.test",
            byteArrayOf(10, 0, 0, 7),
        )
        val dns = PublicHttpsNetworkPolicy.publicDnsForTesting(
            object : Dns {
                override fun lookup(hostname: String): List<InetAddress> =
                    listOf(privateAddress, publicAddress)
            },
        )

        assertEquals(listOf(publicAddress), dns.lookup("mixed.test"))
    }

    @Test
    fun dnsPolicyAcceptsProxyFakeIpAnswers() {
        // Clash/sing-box/Surge in fake-ip mode answer every query from
        // 198.18.0.0/15; the IPv6 pool (fc00::/18 for sing-box) is unique-local
        // and stays blocked, so a dual-stack answer keeps only the IPv4 one.
        val fakeIp = InetAddress.getByAddress(
            "img.example",
            byteArrayOf(198.toByte(), 18, 0, 42),
        )
        val fakeIpUpper = InetAddress.getByAddress(
            "img.example",
            byteArrayOf(198.toByte(), 19, 255.toByte(), 1),
        )
        val fakeIpv6 = InetAddress.getByAddress(
            "img.example",
            ByteArray(16).also {
                it[0] = 0xfc.toByte()
                it[15] = 42
            },
        )
        val dns = PublicHttpsNetworkPolicy.publicDnsForTesting(
            object : Dns {
                override fun lookup(hostname: String): List<InetAddress> =
                    if (hostname == "img.example") {
                        listOf(fakeIpv6, fakeIp)
                    } else {
                        listOf(fakeIpUpper)
                    }
            },
        )

        assertEquals(listOf(fakeIp), dns.lookup("img.example"))
        assertEquals(listOf(fakeIpUpper), dns.lookup("cdn.example"))
    }

    @Test
    fun redirectInterceptorFollowsOnlySameOriginRedirects() {
        val server = newServer()
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/next"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("ok"))
        val client = redirectClient("public.test")
        val url = server.url("/start").newBuilder().host("public.test").build()

        client.newCall(Request.Builder().url(url).build()).execute().use { response ->
            assertEquals(200, response.code)
            assertEquals("ok", response.body?.string())
        }
        assertEquals("/start", server.takeRequest().path)
        assertEquals("/next", server.takeRequest().path)
    }

    @Test
    fun redirectInterceptorRejectsPrivateAndCrossOriginTargetsBeforeConnecting() {
        val server = newServer()
        val client = redirectClient("public.test")
        val url = server.url("/start").newBuilder().host("public.test").build()

        server.enqueue(
            MockResponse().setResponseCode(302).setHeader(
                "Location",
                "http://127.0.0.1:${server.port}/private",
            ),
        )
        assertThrows(IllegalArgumentException::class.java) {
            client.newCall(Request.Builder().url(url).build()).execute().close()
        }
        assertEquals(1, server.requestCount)

        server.enqueue(
            MockResponse().setResponseCode(302).setHeader(
                "Location",
                "http://other.test:${server.port}/cross-origin",
            ),
        )
        assertThrows(IllegalArgumentException::class.java) {
            client.newCall(Request.Builder().url(url).build()).execute().close()
        }
        assertEquals(2, server.requestCount)
    }

    @Test
    fun crossOriginScopeFollowsARedirectorToAnotherPublicHostWithoutCredentials() {
        // Cover-art URLs often point at a redirector on one host that answers
        // with the real CDN host. The old Nitro loader followed these; the
        // same-origin rule made the notification fall back to the default icon.
        val redirector = newServer()
        val cdn = newServer()
        redirector.enqueue(
            MockResponse().setResponseCode(302).setHeader(
                "Location",
                "http://cdn.test:${cdn.port}/cover.jpg",
            ),
        )
        cdn.enqueue(MockResponse().setResponseCode(200).setBody("image"))
        val client = redirectClient(setOf("public.test", "cdn.test"), RedirectScope.CROSS_ORIGIN)
        val url = redirector.url("/cover").newBuilder().host("public.test").build()
        val request = Request.Builder()
            .url(url)
            .header("Cookie", "session=1")
            .header("Authorization", "Bearer token")
            .build()

        client.newCall(request).execute().use { response ->
            assertEquals(200, response.code)
            assertEquals("image", response.body?.string())
        }
        assertEquals("session=1", redirector.takeRequest().getHeader("Cookie"))
        val followed = cdn.takeRequest()
        assertEquals("/cover.jpg", followed.path)
        assertNull(followed.getHeader("Cookie"))
        assertNull(followed.getHeader("Authorization"))
    }

    @Test
    fun crossOriginScopeStillRefusesPrivateTargetsBeforeConnecting() {
        val server = newServer()
        val client = redirectClient(setOf("public.test"), RedirectScope.CROSS_ORIGIN)
        val url = server.url("/start").newBuilder().host("public.test").build()
        val privateTargets = listOf(
            "http://127.0.0.1:${server.port}/loopback",
            "http://192.168.1.10/router",
            "http://[::1]:${server.port}/loopback6",
            "http://[::ffff:10.0.0.1]/mapped",
            "http://nas.local/cover.jpg",
            "http://user:pass@cdn.example/cover.jpg",
        )

        for (target in privateTargets) {
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", target))
            assertThrows(target, IllegalArgumentException::class.java) {
                client.newCall(Request.Builder().url(url).build()).execute().close()
            }
        }
        assertEquals(privateTargets.size, server.requestCount)
    }

    @Test
    fun redirectScopesDifferOnlyInHostChangesAndDowngrades() {
        val httpA = "http://a.example/x".toHttpUrl()
        val httpsA = "https://a.example/x".toHttpUrl()
        val httpB = "http://b.example/y".toHttpUrl()
        val httpsB = "https://b.example/y".toHttpUrl()

        fun allowed(scope: RedirectScope, from: HttpUrl, to: HttpUrl) =
            runCatching {
                PublicHttpsNetworkPolicy.requireAllowedRedirect(scope, from, from, to)
            }.isSuccess

        assertTrue(allowed(RedirectScope.SAME_ORIGIN, httpA, httpsA))
        assertFalse(allowed(RedirectScope.SAME_ORIGIN, httpsA, httpsB))
        assertTrue(allowed(RedirectScope.CROSS_ORIGIN, httpsA, httpsB))
        assertTrue(allowed(RedirectScope.CROSS_ORIGIN, httpA, httpB))
        assertTrue(allowed(RedirectScope.CROSS_ORIGIN, httpA, httpsB))
        assertFalse(allowed(RedirectScope.CROSS_ORIGIN, httpsA, httpB))
        assertFalse(allowed(RedirectScope.CROSS_ORIGIN, httpsA, "http://a.example/x".toHttpUrl()))
    }

    @Test
    fun urlPolicyRefusesPrivateIPLiteralsButKeepsPublicOnes() {
        for (url in listOf(
            "http://10.1.2.3/a.jpg",
            "http://172.16.0.1/a.jpg",
            "http://169.254.169.254/latest",
            "http://[fd00::1]/a.jpg",
            "http://[fe80::1]/a.jpg",
            // fake-ip addresses are only accepted as DNS answers, never as literals
            "http://198.18.0.42/a.jpg",
        )) {
            assertThrows(url, IllegalArgumentException::class.java) {
                PublicHttpsNetworkPolicy.requirePublicRemote(url)
            }
        }
        assertEquals(
            "93.184.216.34",
            PublicHttpsNetworkPolicy.requirePublicRemote("http://93.184.216.34/a.jpg").host,
        )
        assertEquals(
            "2606:2800:220:1:248:1893:25c8:1946",
            PublicHttpsNetworkPolicy.requirePublicRemote(
                "https://[2606:2800:220:1:248:1893:25c8:1946]/a.jpg",
            ).host,
        )
    }

    @Test
    fun urlPolicyAllowsCleartextButStillRefusesCredentialsAndBadSchemes() {
        // Scheme policy moved to JS (basic.allowPluginInsecureHttp) on
        // 2026-07-26. Enforcing HTTPS here had silently broken downloads,
        // CENC playback and cover-art embedding for http:// sources.
        assertEquals(
            "http",
            PublicHttpsNetworkPolicy.requirePublicRemote(
                "http://public.example/audio.mp3",
            ).scheme,
        )
        assertEquals(
            "https",
            PublicHttpsNetworkPolicy.requirePublicRemote(
                "https://public.example/audio.mp3",
            ).scheme,
        )
        assertThrows(IllegalArgumentException::class.java) {
            PublicHttpsNetworkPolicy.requirePublicRemote(
                "ftp://public.example/audio.mp3",
            )
        }
        val credentialsError = assertThrows(IllegalArgumentException::class.java) {
            PublicHttpsNetworkPolicy.requirePublicRemote(
                "https://user:pass@public.example/audio.mp3",
            )
        }
        assertTrue(credentialsError.message.orEmpty().contains("credentials"))
    }

    private fun newServer(): MockWebServer = MockWebServer().also {
        it.start(loopbackAddress, 0)
        servers += it
    }

    private fun redirectClient(hostname: String): OkHttpClient =
        redirectClient(setOf(hostname), RedirectScope.SAME_ORIGIN)

    private fun redirectClient(hostnames: Set<String>, scope: RedirectScope): OkHttpClient =
        OkHttpClient.Builder()
            .dns(
                object : Dns {
                    override fun lookup(hostname: String): List<InetAddress> =
                        if (hostname in hostnames) {
                            listOf(loopbackAddress)
                        } else {
                            throw UnknownHostException(hostname)
                        }
                }
            )
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(
                PublicHttpsNetworkPolicy.redirectInterceptorForTesting(redirectScope = scope),
            )
            .build()
}
