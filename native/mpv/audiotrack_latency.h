/*
 * AudioTrack startup delay accounting.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */
#ifndef MP_AUDIO_OUT_AUDIOTRACK_LATENCY_H
#define MP_AUDIO_OUT_AUDIOTRACK_LATENCY_H

#include <stdbool.h>
#include <stdint.h>

/* Without a device timestamp, getLatency() estimates downstream hardware
 * latency. Immediately after creation/flush that estimate can exceed all
 * audio submitted since reset, placing the output clock before its origin.
 * Bound only this startup estimate. Once a timestamp or at least the existing
 * two-second maximum delay is available, leave steady-state accounting alone,
 * including the uint32 frame counter's eventual wraparound.
 */
static inline double mp_audiotrack_startup_delay(double delay, uint32_t written,
    int rate, bool timestamp_valid, bool passthrough, bool *warmup)
{
    if (timestamp_valid || written / (double)rate >= 2.0)
        *warmup = false;
    if (*warmup && !timestamp_valid && !passthrough) {
        double submitted = written / (double)rate;
        if (delay > submitted)
            return submitted;
    }
    return delay;
}

#endif
