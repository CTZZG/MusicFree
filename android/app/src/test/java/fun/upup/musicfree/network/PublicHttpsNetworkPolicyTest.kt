package `fun`.upup.musicfree.network

import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PublicHttpsNetworkPolicyTest {
    private val servers = mutableListOf<MockWebServer>()

    @After
    fun tearDown() {
        servers.forEach(MockWebServer::shutdown)
    }

    @Test
    fun `dns policy revalidates every lookup and rejects a public to private flip`() {
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
    fun `dns policy rejects an IPv4 mapped IPv6 loopback address`() {
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
    fun `redirect interceptor follows only same origin redirects`() {
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
    fun `redirect interceptor rejects private and cross origin targets before connecting`() {
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
    fun `URL policy allows cleartext but still refuses credentials and bad schemes`() {
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
        it.start()
        servers += it
    }

    private fun redirectClient(hostname: String): OkHttpClient =
        OkHttpClient.Builder()
            .dns(
                object : Dns {
                    override fun lookup(requestedHost: String): List<InetAddress> =
                        if (requestedHost == hostname) {
                            listOf(InetAddress.getLoopbackAddress())
                        } else {
                            throw UnknownHostException(requestedHost)
                        }
                }
            )
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(
                PublicHttpsNetworkPolicy.redirectInterceptorForTesting(),
            )
            .build()
}
