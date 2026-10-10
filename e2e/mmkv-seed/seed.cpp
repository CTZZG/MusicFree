// 往旧版（0.7.3 及以前）的 MMKV 存储里写测试数据，见 e2e/README.md 的“旧版数据迁移”。
//
// 0.7.3 和现在的应用都用 react-native-mmkv 4.3.1，底层是 MMKV 2.4.0；这里用同一个版本的
// MMKV 核心读写，写出的文件和 0.7.3 自己写的格式一样。只写字符串：0.7.3 的歌单、附加信息
// 都是 JSON 字符串。
//
//   mmkv-seed set  <目录> <store id> <键> <值>   写入（已有的文件接着用，别的键不动）
//   mmkv-seed get  <目录> <store id> <键>         打印值；没有这个键时返回 1
//   mmkv-seed keys <目录> <store id>              每行打印一个键
#include <MMKV/MMKV.h>

#include <cstdio>
#include <cstring>
#include <string>

namespace {

int usage() {
    std::fprintf(stderr,
                 "usage: mmkv-seed set <dir> <id> <key> <value>\n"
                 "       mmkv-seed get <dir> <id> <key>\n"
                 "       mmkv-seed keys <dir> <id>\n");
    return 2;
}

MMKV *open(const std::string &dir, const std::string &id) {
    MMKV::initializeMMKV(dir, MMKVLogNone);
    // 和 react-native-mmkv 一样：单进程、不加密、数据目录由调用方给
    MMKV *kv = MMKV::mmkvWithID(id, MMKV_SINGLE_PROCESS, nullptr, &dir);
    if (!kv) {
        std::fprintf(stderr, "cannot open MMKV %s in %s\n", id.c_str(), dir.c_str());
    }
    return kv;
}

} // namespace

int main(int argc, char **argv) {
    if (argc < 4) {
        return usage();
    }
    const std::string command = argv[1];
    const std::string dir = argv[2];
    const std::string id = argv[3];

    if (command == "set" && argc == 6) {
        MMKV *kv = open(dir, id);
        if (!kv || !kv->set(std::string(argv[5]), std::string(argv[4]))) {
            return 1;
        }
        kv->sync(MMKV_SYNC);
        kv->close();
        return 0;
    }
    if (command == "get" && argc == 5) {
        MMKV *kv = open(dir, id);
        std::string value;
        if (!kv || !kv->getString(std::string(argv[4]), value)) {
            return 1;
        }
        std::fwrite(value.data(), 1, value.size(), stdout);
        std::fputc('\n', stdout);
        kv->close();
        return 0;
    }
    if (command == "keys" && argc == 4) {
        MMKV *kv = open(dir, id);
        if (!kv) {
            return 1;
        }
        for (const auto &key : kv->allKeys()) {
            std::printf("%s\n", key.c_str());
        }
        kv->close();
        return 0;
    }
    return usage();
}
