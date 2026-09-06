#!/usr/bin/env bash
# =====================================================================
# run_unit_tests.sh — Node ESM 算法单元测试入口
# 列出所有 *.mjs 测试,逐个运行,聚合结果。
# 不依赖 npm/node_modules,直接用 system node。
# =====================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# SCRIPT_DIR = .workbuddy/,project root is parent
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TESTS_DIR="$PROJECT_ROOT/static/tests"

# 优先使用 WorkBuddy managed Node(22.22.2),system node 兜底
NODE_BIN="${NODE_BIN:-C:/Users/xingz/.workbuddy/binaries/node/versions/22.22.2-2/node.exe}"
if [ ! -x "$NODE_BIN" ]; then
    NODE_BIN="$(command -v node)"
fi

# 把 posix 路径转成 Windows 路径(避免 /c/Users 被识别成 C:\c\Users)
WIN_TESTS_DIR="$(cygpath -w "$TESTS_DIR")"

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
    WIN_TEST_FILE="$(cygpath -w "$test_file")"
    if "$NODE_BIN" "$WIN_TEST_FILE"; then
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
