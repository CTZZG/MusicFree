# shellcheck shell=sh
# 在设备上以 root 跑（storage.sh 推到 /data/local/tmp 再执行）：
#
#   sh device_place.sh <参照文件> <源文件> <目标>
#
# 把源文件放到目标位置，让应用像对待自己写的文件一样能读写：目标已经存在就原地覆盖内容（属主、
# 权限、SELinux 标签都不变）；不存在就复制过去，属主、权限、SELinux 标签照参照文件（应用自己建的
# 同目录文件）设置。以 root 新建的文件默认是 root 的、标签也不带应用的类别，应用打不开。
ref=$1
src=$2
dst=$3
if [ ! -f "$ref" ] || [ ! -f "$src" ]; then
    echo "参照文件或源文件不存在：$ref $src" >&2
    exit 1
fi
if [ -e "$dst" ]; then
    cat "$src" > "$dst" || exit 1
else
    cp "$src" "$dst" || exit 1
    chown "$(stat -c %u:%g "$ref")" "$dst" || exit 1
    chmod "$(stat -c %a "$ref")" "$dst" || exit 1
    context=$(stat -c %C "$ref" 2>/dev/null)
    if [ -z "$context" ] || [ "$context" = "?" ]; then
        context=$(ls -Zd "$ref" | cut -d' ' -f1)
    fi
    chcon "$context" "$dst" || exit 1
fi
