#include <assert.h>
#include <stdio.h>

#include "../audiotrack_latency.h"

int main(void)
{
    bool startup = true;
    assert(mp_audiotrack_startup_delay(.45, 0, 16000, false, false, &startup) == 0);
    assert(mp_audiotrack_startup_delay(.45, 1600, 16000, false, false, &startup) == .1);
    assert(mp_audiotrack_startup_delay(.45, 8000, 16000, false, false, &startup) == .45);
    assert(startup);

    // A real device timestamp replaces the startup estimate.
    assert(mp_audiotrack_startup_delay(.45, 0, 16000, true, false, &startup) == .45);
    assert(!startup);

    // Encoded passthrough does not use the PCM hardware-latency estimate.
    startup = true;
    assert(mp_audiotrack_startup_delay(.45, 0, 16000, false, true, &startup) == .45);

    // Two seconds of submitted audio ends startup even without a timestamp.
    assert(mp_audiotrack_startup_delay(.45, 32000, 16000, false, false, &startup) == .45);
    assert(!startup);

    // A later uint32 wrap must not incorrectly restart startup accounting.
    assert(mp_audiotrack_startup_delay(.45, 3, 16000, false, false, &startup) == .45);

    // Flush re-arms the bound, including a valid position of zero.
    startup = true;
    assert(mp_audiotrack_startup_delay(.45, 3, 16000, false, false, &startup) == 3. / 16000);
    assert(mp_audiotrack_startup_delay(.45, 0, 48000, false, false, &startup) == 0);
    assert(mp_audiotrack_startup_delay(.45, 4800, 48000, false, false, &startup) == .1);
    assert(mp_audiotrack_startup_delay(.45, 96000, 48000, false, false, &startup) == .45);
    assert(!startup);
    puts("AudioTrack delay: startup, timestamps, passthrough, steady state, wrap and reset passed");
}
