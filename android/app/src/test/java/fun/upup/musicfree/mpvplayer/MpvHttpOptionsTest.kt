package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MpvHttpOptionsTest {
    @Test
    fun encodeHeaderFieldsPreservesCommasStripsControlCharsAndDropsForbiddenHeaders() {
        val headers = linkedMapOf<String, String?>(
            "Host" to "evil.example",
            "Connection" to "keep-alive",
            "Content-Length" to "100",
            "Transfer-Encoding" to "chunked",
            "Proxy-Authorization" to "Basic secret",
            "Bad Key" to "ignored",
            "Colon:Key" to "ignored",
            "Accept" to "audio/mpeg, */*;q=0.8",
            "Cookie" to "a=1, b=2\r\nX-Injected: evil\u0000",
            "Referer" to "https://music.example/\n",
        )

        val encoded = MpvHttpOptions.encodeHeaderFieldsOption(headers)
        val first = "Accept: audio/mpeg, */*;q=0.8"
        val second = "Cookie: a=1, b=2X-Injected: evil"
        val third = "Referer: https://music.example/"
        val expected =
            "%${first.toByteArray().size}%$first," +
                "%${second.toByteArray().size}%$second," +
                "%${third.toByteArray().size}%$third"

        assertEquals(expected, encoded)
        assertFalse(encoded.contains("\r"))
        assertFalse(encoded.contains("\n"))
        assertFalse(encoded.contains("\u0000"))
    }

    @Test
    fun buildLoadFileCommandLengthPrefixesOptionsIncludingCommaUserAgent() {
        val headers = MpvHttpOptions.encodeHeaderFieldsOption(mapOf("Referer" to "https://a.test/"))
        val ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0\r\n"
        val cmd = MpvHttpOptions.buildLoadFileCommand(
            url = "https://cdn.example.com/song.mp3",
            mode = "append",
            headerFieldsList = headers,
            userAgent = ua,
        )

        assertEquals(5, cmd.size)
        assertArrayEquals(arrayOf("loadfile", "https://cdn.example.com/song.mp3", "append", "-1"), cmd.copyOf(4))
        assertTrue(cmd[4].startsWith("http-header-fields=%"))
        assertTrue(cmd[4].contains(",user-agent=%"))
        assertTrue(cmd[4].contains("KHTML, like Gecko"))
        assertFalse(cmd[4].contains("\r"))
        assertFalse(cmd[4].contains("\n"))
    }

    @Test
    fun validateMediaUrlAllowsValidPathsAndTrustedProxyWhileBlockingSchemesAndUnauthorizedHttp() {
        MpvHttpOptions.validateMediaUrl("/data/user/0/song.mp3", "audio", false, false)
        MpvHttpOptions.validateMediaUrl("file:///sdcard/song.mp3", "mv", false, false)
        MpvHttpOptions.validateMediaUrl("content://media/external/audio/1", "audio", false, false)
        MpvHttpOptions.validateMediaUrl("http://127.0.0.1:45678/stream/tok.m4a", "audio", true, false)
        MpvHttpOptions.validateMediaUrl("https://cdn.example.com/mv.mp4", "mv", false, false)
        MpvHttpOptions.validateMediaUrl("http://cdn.example.com/mv.mp4", "mv", false, true)

        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("edl://%5%a.mp3", "audio", false, true)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("lavfi://anullsrc", "mv", false, true)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("http://127.0.0.1:45678/stream/tok.m4a", "audio", false, true)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("http://127.0.0.1:45678/stream/tok.mp4", "mv", true, true)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("http://192.168.1.5/mv.mp4", "mv", false, true)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("http://cdn.example.com/mv.mp4", "mv", false, false)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("http://cdn.example.com/a.mp3", "audio", false, false)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("https://cdn.example.com/a.mp3\r\n", "audio", false, false)
        }
        // Self-hosted LAN audio servers (WebDAV/Subsonic) remain allowed when HTTP is permitted,
        // while MV still requires public remote hosts and audio still blocks link-local/metadata/NAT64-loopback.
        MpvHttpOptions.validateMediaUrl("http://192.168.1.50:4533/rest/stream?id=a", "audio", false, null)
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("http://169.254.169.254/latest", "audio", false, true)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("https://[64:ff9b::127.0.0.1]/a.mp3", "audio", false, false)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("https://[64:ff9b::169.254.169.254]/a.mp3", "audio", false, false)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("https://[64:ff9b::10.0.0.1]/mv.mp4", "mv", false, false)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MpvHttpOptions.validateMediaUrl("https://speaker.local/mv.mp4", "mv", false, false)
        }
    }

    @Test
    fun encodeLengthPrefixedCountsStandardUtf8BytesForSupplementaryUnicode() {
        val ua = "MusicFree/0.15 🎵 Player"
        val headers = MpvHttpOptions.encodeHeaderFieldsOption(mapOf("X-Title" to "Song 🎶"))
        val expectedHeaderEntry = "X-Title: Song 🎶"
        assertEquals(
            "%${expectedHeaderEntry.toByteArray(Charsets.UTF_8).size}%$expectedHeaderEntry",
            headers,
        )
        val cmd = MpvHttpOptions.buildLoadFileCommand(
            url = "https://cdn.example.com/🎵.mp3",
            mode = "replace",
            headerFieldsList = headers,
            userAgent = ua,
        )
        assertTrue(cmd[4].contains("user-agent=%${ua.toByteArray(Charsets.UTF_8).size}%$ua"))
    }
}
