#!/usr/bin/env python3
"""Host C++ regression tests for android/app/src/main/cpp/cenc/mp4.cpp and CencDecoder."""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CPP_DIR = ROOT / "android" / "app" / "src" / "main" / "cpp" / "cenc"

DRIVER_CPP = r'''
#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

#include "aes.h"
#include "cenc_decoder.h"
#include "mp4.h"

namespace {

void pushU32(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back(static_cast<uint8_t>(v >> 24));
    out.push_back(static_cast<uint8_t>(v >> 16));
    out.push_back(static_cast<uint8_t>(v >> 8));
    out.push_back(static_cast<uint8_t>(v));
}

void pushU16(std::vector<uint8_t>& out, uint16_t v) {
    out.push_back(static_cast<uint8_t>(v >> 8));
    out.push_back(static_cast<uint8_t>(v));
}

void pushBytes(std::vector<uint8_t>& out, const void* data, size_t n) {
    const auto* p = static_cast<const uint8_t*>(data);
    out.insert(out.end(), p, p + n);
}

std::vector<uint8_t> makeBox(const char type[4], const std::vector<uint8_t>& payload) {
    std::vector<uint8_t> out;
    pushU32(out, static_cast<uint32_t>(8 + payload.size()));
    pushBytes(out, type, 4);
    pushBytes(out, payload.data(), payload.size());
    return out;
}

std::vector<uint8_t> concat(const std::vector<std::vector<uint8_t>>& parts) {
    std::vector<uint8_t> out;
    for (const auto& p : parts) {
        pushBytes(out, p.data(), p.size());
    }
    return out;
}

std::vector<uint8_t> makeFullBoxPayload(uint8_t version, uint32_t flags, const std::vector<uint8_t>& body) {
    std::vector<uint8_t> p;
    p.push_back(version);
    p.push_back(static_cast<uint8_t>((flags >> 16) & 0xFF));
    p.push_back(static_cast<uint8_t>((flags >> 8) & 0xFF));
    p.push_back(static_cast<uint8_t>(flags & 0xFF));
    pushBytes(p, body.data(), body.size());
    return p;
}

std::vector<uint8_t> makeStcoPayload(uint32_t reportedCount, const std::vector<uint32_t>& offsets) {
    std::vector<uint8_t> body;
    pushU32(body, reportedCount);
    for (uint32_t off : offsets) pushU32(body, off);
    return makeFullBoxPayload(0, 0, body);
}

std::vector<uint8_t> makeCo64Payload(uint32_t reportedCount, const std::vector<uint64_t>& offsets) {
    std::vector<uint8_t> body;
    pushU32(body, reportedCount);
    for (uint64_t off : offsets) {
        pushU32(body, static_cast<uint32_t>(off >> 32));
        pushU32(body, static_cast<uint32_t>(off));
    }
    return makeFullBoxPayload(0, 0, body);
}

std::vector<uint8_t> makeEncryptedAudioStbl(uint32_t chunkOffset, uint32_t sampleSize, const uint8_t iv8[8],
                                            uint16_t clearBytes, uint32_t encBytes,
                                            const std::vector<uint8_t>& extraChild = {}) {
    // tenc
    std::vector<uint8_t> tencBody(20, 0);
    tencBody[2] = 1; // isProtected
    tencBody[3] = 8; // per_sample_IV_size = 8
    auto tenc = makeBox("tenc", makeFullBoxPayload(0, 0, tencBody));
    auto schi = makeBox("schi", tenc);
    auto frma = makeBox("frma", {'m', 'p', '4', 'a'});
    auto sinf = makeBox("sinf", concat({frma, schi}));
    auto esds = makeBox("esds", {0, 0, 0, 0});

    // AudioSampleEntry (28 bytes) + children
    std::vector<uint8_t> encaPayload(28, 0);
    encaPayload[7] = 1; // data_reference_index = 1
    pushBytes(encaPayload, esds.data(), esds.size());
    pushBytes(encaPayload, sinf.data(), sinf.size());
    auto enca = makeBox("enca", encaPayload);

    std::vector<uint8_t> stsdBody;
    pushU32(stsdBody, 1); // entry_count
    pushBytes(stsdBody, enca.data(), enca.size());
    auto stsd = makeBox("stsd", makeFullBoxPayload(0, 0, stsdBody));

    // stsz
    std::vector<uint8_t> stszBody;
    pushU32(stszBody, sampleSize); // uniform size
    pushU32(stszBody, 1);          // sample_count
    auto stsz = makeBox("stsz", makeFullBoxPayload(0, 0, stszBody));

    // stsc
    std::vector<uint8_t> stscBody;
    pushU32(stscBody, 1); // entry_count
    pushU32(stscBody, 1); // first_chunk
    pushU32(stscBody, 1); // samples_per_chunk
    pushU32(stscBody, 1); // sdi
    auto stsc = makeBox("stsc", makeFullBoxPayload(0, 0, stscBody));

    // stco
    auto stco = makeBox("stco", makeStcoPayload(1, {chunkOffset}));

    // senc with subsamples (flag 0x2)
    std::vector<uint8_t> sencBody;
    pushU32(sencBody, 1); // sample_count
    pushBytes(sencBody, iv8, 8);
    pushU16(sencBody, 1); // subsample_count
    pushU16(sencBody, clearBytes);
    pushU32(sencBody, encBytes);
    auto senc = makeBox("senc", makeFullBoxPayload(0, 0x000002, sencBody));

    std::vector<std::vector<uint8_t>> children = {stsd, stsz, stsc, stco, senc};
    if (!extraChild.empty()) children.push_back(extraChild);
    return makeBox("stbl", concat(children));
}

std::vector<uint8_t> makeTrack(const std::vector<uint8_t>& stbl) {
    return makeBox("trak", makeBox("mdia", makeBox("minf", stbl)));
}

void incrCounter128(uint8_t c[16], uint64_t add) {
    uint32_t carry = 0;
    for (int i = 15; i >= 0; --i) {
        uint64_t sum = static_cast<uint64_t>(c[i]) + static_cast<uint8_t>(add & 0xFF) + carry;
        c[i] = static_cast<uint8_t>(sum & 0xFF);
        carry = static_cast<uint32_t>(sum >> 8);
        add >>= 8;
        if (add == 0 && carry == 0) break;
    }
}

void xorCtr(const ence::Aes128& aes, const uint8_t iv8[8], uint8_t* data, size_t len) {
    uint8_t counter[16] = {0};
    std::memcpy(counter, iv8, 8);
    uint8_t ks[16];
    for (size_t i = 0; i < len; i += 16) {
        aes.encryptBlock(counter, ks);
        size_t chunk = std::min<size_t>(16, len - i);
        for (size_t j = 0; j < chunk; ++j) data[i + j] ^= ks[j];
        incrCounter128(counter, 1);
    }
}

bool containsBytes(const std::vector<uint8_t>& haystack, const char* needle4) {
    for (size_t i = 0; i + 4 <= haystack.size(); ++i) {
        if (std::memcmp(&haystack[i], needle4, 4) == 0) return true;
    }
    return false;
}

} // namespace

int main() {
    const uint8_t cek[16] = {1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16};
    const uint8_t iv8[8] = {0xaa,0xbb,0xcc,0xdd,0x11,0x22,0x33,0x44};
    const std::vector<uint8_t> ftyp = makeBox("ftyp", {'M','4','A',' '});

    // Case 1: valid single-track encrypted enca rewrite + subsample CTR decryption
    {
        const std::vector<uint8_t> plaintext = {
            'C','L','R','0', // 4 clear bytes
            'S','E','C','R','E','T','-','A','U','D','I','O','!','!','!','!', // 16 encrypted bytes
            'E','N','D','!' // 4 more encrypted bytes
        };
        const uint32_t sampleSize = static_cast<uint32_t>(plaintext.size());
        const uint32_t mdatPayloadOff = 512;
        auto stbl = makeEncryptedAudioStbl(mdatPayloadOff, sampleSize, iv8, 4, sampleSize - 4);
        auto moov = makeBox("moov", makeTrack(stbl));
        ence::CencDecoder dec(ftyp.data(), ftyp.size(), moov.data(), moov.size(), cek, mdatPayloadOff, sampleSize);
        assert(dec.ok());
        assert(!containsBytes(dec.header(), "enca"));
        assert(!containsBytes(dec.header(), "sinf"));
        assert(!containsBytes(dec.header(), "senc"));
        assert(containsBytes(dec.header(), "mp4a"));

        std::vector<uint8_t> ciphertext = plaintext;
        ence::Aes128 aes(cek);
        xorCtr(aes, iv8, ciphertext.data() + 4, ciphertext.size() - 4);

        // Decrypt full and unaligned mid-sample slice
        std::vector<uint8_t> fullOut = ciphertext;
        dec.decrypt(0, fullOut.data(), fullOut.size());
        assert(fullOut == plaintext);

        std::vector<uint8_t> sliceOut(ciphertext.begin() + 7, ciphertext.begin() + 21);
        dec.decrypt(7, sliceOut.data(), sliceOut.size());
        assert(std::memcmp(sliceOut.data(), plaintext.data() + 7, sliceOut.size()) == 0);
    }

    // Case 2: secondary trak with forged huge stco.count rejected safely
    {
        const uint32_t mdatOff = 600;
        auto stbl1 = makeEncryptedAudioStbl(mdatOff, 32, iv8, 4, 28);
        auto badStco = makeBox("stco", makeStcoPayload(0x7fffffffu, {mdatOff}));
        auto stbl2 = makeBox("stbl", badStco);
        auto moov = makeBox("moov", concat({makeTrack(stbl1), makeTrack(stbl2)}));
        auto res = ence::parseAndRewrite(ftyp.data(), ftyp.size(), moov.data(), moov.size(), mdatOff, 32, cek);
        assert(!res.ok);
    }

    // Case 3: co64 sibling inside same encrypted stbl with forged huge count rejected safely
    {
        const uint32_t mdatOff = 600;
        auto badCo64 = makeBox("co64", makeCo64Payload(0x00100000u, {mdatOff}));
        auto stbl = makeEncryptedAudioStbl(mdatOff, 32, iv8, 4, 28, badCo64);
        auto moov = makeBox("moov", makeTrack(stbl));
        auto res = ence::parseAndRewrite(ftyp.data(), ftyp.size(), moov.data(), moov.size(), mdatOff, 32, cek);
        assert(!res.ok);
    }

    // Case 4: secondary trak with truncated stsd (<8 bytes payload) rejected as bad stsd
    {
        const uint32_t mdatOff = 600;
        auto stbl1 = makeEncryptedAudioStbl(mdatOff, 32, iv8, 4, 28);
        auto badStsd = makeBox("stsd", {0, 0, 0, 0}); // 4 bytes < 8
        auto stbl2 = makeBox("stbl", badStsd);
        auto moov = makeBox("moov", concat({makeTrack(stbl1), makeTrack(stbl2)}));
        auto res = ence::parseAndRewrite(ftyp.data(), ftyp.size(), moov.data(), moov.size(), mdatOff, 32, cek);
        assert(!res.ok);
        assert(res.error == "bad stsd");
    }

    // Case 5: primary sample offset outside mdat rejected
    {
        const uint32_t mdatOff = 600;
        auto stbl = makeEncryptedAudioStbl(mdatOff + 40, 32, iv8, 4, 28);
        auto moov = makeBox("moov", makeTrack(stbl));
        auto res = ence::parseAndRewrite(ftyp.data(), ftyp.size(), moov.data(), moov.size(), mdatOff, 32, cek);
        assert(!res.ok);
    }

    // Case 6: secondary trak with oldOff < mdatPayloadFileOffset causing unsigned underflow rejected
    {
        const uint32_t mdatOff = 2000;
        auto stbl1 = makeEncryptedAudioStbl(mdatOff, 32, iv8, 4, 28);
        auto badStco = makeBox("stco", makeStcoPayload(1, {16}));
        auto stbl2 = makeBox("stbl", badStco);
        auto moov = makeBox("moov", concat({makeTrack(stbl1), makeTrack(stbl2)}));
        auto res = ence::parseAndRewrite(ftyp.data(), ftyp.size(), moov.data(), moov.size(), mdatOff, 32, cek);
        assert(!res.ok);
        assert(res.error == "chunk offset underflow");
    }

    std::cout << "{\"ok\":true,\"cases\":6}\n";
    return 0;
}
'''


def find_compiler():
    for candidate in ("c++", "g++", "clang++"):
        found = shutil.which(candidate)
        if found:
            return found
    raise RuntimeError("No C++ compiler found (tried c++, g++, clang++)")


def main():
    compiler = find_compiler()
    with tempfile.TemporaryDirectory(prefix="mf-cenc-check-") as tmp:
        tmp_path = Path(tmp)
        driver_path = tmp_path / "driver.cpp"
        exe_path = tmp_path / ("check_cenc.exe" if os.name == "nt" else "check_cenc")
        driver_path.write_text(DRIVER_CPP, encoding="utf-8")
        cmd = [
            compiler,
            "-std=c++17",
            "-O2",
            "-Wall",
            "-Wextra",
            f"-I{CPP_DIR}",
            str(driver_path),
            str(CPP_DIR / "mp4.cpp"),
            str(CPP_DIR / "aes.cpp"),
            str(CPP_DIR / "cenc_decoder.cpp"),
            "-o",
            str(exe_path),
        ]
        subprocess.run(cmd, check=True)
        run = subprocess.run([str(exe_path)], check=True, text=True, capture_output=True)
        data = json.loads(run.stdout.strip())
        assert data.get("ok") is True and data.get("cases") == 6, data
        print(json.dumps(data))


if __name__ == "__main__":
    main()
