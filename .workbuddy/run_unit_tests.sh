#!/usr/bin/env bash
# =====================================================================
# run_unit_tests.sh — Node ESM 算法单元测试入口
# 列出 static/tests/*.mjs,逐个运行,聚合结果。
# 不依赖 npm/node_modules,直接用 node。
# 跨平台:Windows(Git Bash)/ Linux / macOS 均可 —— 云端 WorkBuddy 是 Linux,
#         所以本脚本**不得**依赖 cygpath / 写死的 Windows 盘符路径。
# =====================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# SCRIPT_DIR = .workbuddy/,project root is parent
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TESTS_DIR="$PROJECT_ROOT/static/tests"

# ---- 选 node:① $NODE_BIN ② WorkBuddy managed(仅 Windows 存在) ③ PATH 里的 node ----
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
    NODE_BIN=""
    for cand in \
        "C:/Users/xingz/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" \
        "C:/Users/xingz/.workbuddy/binaries/node/versions/22.22.2-2/node.exe" \
        "C:/Users/xingz/.workbuddy/binaries/node/versions/22.22.2/node.exe"; do
        if [ -x "$cand" ]; then NODE_BIN="$cand"; break; fi
    done
fi
if [ -z "$NODE_BIN" ]; then
    NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE_BIN" ]; then
    echo "❌ 找不到 node:设 NODE_BIN,或把 node 放进 PATH"
    exit 1
fi

# ---- 路径转换:Git Bash/msys 上需要 cygpath;Linux/macOS 原样传 ----
to_native() {
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -w "$1"
    else
        printf '%s' "$1"
    fi
}

if [ ! -d "$TESTS_DIR" ]; then
    echo "❌ 测试目录不存在: $TESTS_DIR"
    exit 1
fi

echo "▶ Using node: $NODE_BIN"
echo "▶ Test dir : $TESTS_DIR"
echo "=========================================="

FAIL=0
PASS=0
TOTAL=0

for test_file in "$TESTS_DIR"/*.mjs; do
    [ -e "$test_file" ] || continue
    TOTAL=$((TOTAL + 1))
    name="$(basename "$test_file")"
    echo ""
    echo "▶ Running: $name"
    echo "----------"
    if "$NODE_BIN" "$(to_native "$test_file")"; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
    fi
done

echo ""
echo "=========================================="
echo "汇总: $((PASS + FAIL)) 个测试文件,$PASS 通过,$FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
