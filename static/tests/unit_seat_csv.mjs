// =====================================================================
// tests/unit_seat_csv.mjs
//
// Node ESM 单元测试 — modules/csv-export.js(座位表 CSV 导出)
//
// 覆盖:
//   A. 学生视角 — 讲台在前、行/列正序、空座位留空
//   B. 教师视角 — 行列均镜像、讲台在后,但标签仍为真实坐标
//   C. CSV 转义 — 逗号 / 双引号 / 换行
//   D. 选项 — includeHeader / includePodium / emptyLabel
//   E. 边界 — 0 行 0 列 / seats 长度不足 / 输入不被修改
//   F. 文件名与日期 — 非法字符替换、无 BOM 污染
//
// 运行: node static/tests/unit_seat_csv.mjs
// 退出码: 0 = 全部通过
// =====================================================================

const {
    buildSeatCsv,
    buildSeatCsvFilename,
    formatDateStamp,
    escapeCsvCell,
    CSV_BOM
} = await import('../modules/csv-export.js');

// --- 迷你 runner ---
let __passed__ = 0;
let __failed__ = 0;
const __failures__ = [];
let __current__ = '';

function group(name, fn) {
    __current__ = name;
    console.log(`\n# ${name}`);
    try {
        fn();
    } catch (e) {
        __failed__++;
        __failures__.push({ group: name, error: e });
        console.log(`  ! group threw: ${e.message}`);
    }
}

function test(name, fn) {
    try {
        fn();
        __passed__++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        __failed__++;
        __failures__.push({ name: `${__current__} > ${name}`, error: e });
        console.log(`  ✗ ${name}`);
        console.log(`      ${e.message}`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error((msg ? msg + ': ' : '') + `expected ${e}, got ${a}`);
}

// --- 公共测试数据:2 行 × 3 列 ---
//   seats 为学生视角 row-major
//     第1排: 张三  李四  空
//     第2排: 王五  空    赵六
const STUDENTS = [
    { id: 's1', name: '张三' },
    { id: 's2', name: '李四' },
    { id: 's3', name: '王五' },
    { id: 's4', name: '赵六' }
];
const SEATS = ['s1', 's2', null, 's3', null, 's4'];

function studentViewCsv(extra) {
    return buildSeatCsv(Object.assign({
        rows: 2,
        cols: 3,
        seats: SEATS,
        students: STUDENTS,
        viewMode: 'student'
    }, extra || {}));
}

function teacherViewCsv(extra) {
    return buildSeatCsv(Object.assign({
        rows: 2,
        cols: 3,
        seats: SEATS,
        students: STUDENTS,
        viewMode: 'teacher'
    }, extra || {}));
}

// =====================================================================
// A. 学生视角
// =====================================================================
group('A. 学生视角', function () {
    test('讲台在顶部, 行/列按真实顺序', function () {
        assertEq(studentViewCsv().split('\r\n'), [
            '讲台,,,',
            '排\\列,第1列,第2列,第3列',
            '第1排,张三,李四,',
            '第2排,王五,,赵六'
        ]);
    });

    test('使用 CRLF 作为行分隔', function () {
        const csv = studentViewCsv();
        assert(csv.indexOf('\r\n') > -1, '应有 CRLF');
        assert(csv.indexOf('\n\n') === -1, '不应出现空行');
    });

    test('空座位默认输出空单元格', function () {
        const lines = studentViewCsv().split('\r\n');
        assertEq(lines[3], '第2排,王五,,赵六');
    });
});

// =====================================================================
// B. 教师视角(与屏幕镜像一致)
// =====================================================================
group('B. 教师视角', function () {
    test('行列均镜像, 讲台移到底部', function () {
        assertEq(teacherViewCsv().split('\r\n'), [
            '排\\列,第3列,第2列,第1列',
            '第2排,赵六,,王五',
            '第1排,,李四,张三',
            '讲台,,,'
        ]);
    });

    test('行标签仍是真实排号(顶行=最后一排)', function () {
        const lines = teacherViewCsv().split('\r\n');
        assert(lines[1].indexOf('第2排') === 0, '教师视角顶行应为第2排, 实际: ' + lines[1]);
        assert(lines[2].indexOf('第1排') === 0, '教师视角末行应为第1排, 实际: ' + lines[2]);
    });

    test('8×8 全空时顶行是第8排、首列是第8列', function () {
        const csv = buildSeatCsv({
            rows: 8, cols: 8, seats: Array(64).fill(null), students: [], viewMode: 'teacher'
        });
        const lines = csv.split('\r\n');
        assert(lines[0].indexOf('第8列') > -1, '表头应含第8列');
        assert(lines[1].indexOf('第8排') === 0, '首个数据行应为第8排');
        assertEq(lines[1], '第8排' + ','.repeat(8));
    });
});

// =====================================================================
// C. CSV 转义
// =====================================================================
group('C. CSV 转义', function () {
    const tricky = [
        { id: 'a', name: '张,三' },
        { id: 'b', name: '他说"好"' },
        { id: 'c', name: '换\n行' }
    ];

    test('逗号 → 整体加引号', function () {
        assertEq(escapeCsvCell('张,三'), '"张,三"');
    });

    test('双引号 → 翻倍并整体加引号', function () {
        assertEq(escapeCsvCell('他说"好"'), '"他说""好"""');
    });

    test('换行 → 整体加引号', function () {
        assertEq(escapeCsvCell('换\n行'), '"换\n行"');
    });

    test('普通名字不加引号', function () {
        assertEq(escapeCsvCell('张三'), '张三');
        assertEq(escapeCsvCell(null), '');
    });

    test('生成结果包含正确转义', function () {
        const csv = buildSeatCsv({
            rows: 1, cols: 3, seats: ['a', 'b', 'c'], students: tricky,
            viewMode: 'student', includePodium: false, includeHeader: false
        });
        assertEq(csv, '第1排,"张,三","他说""好""","换\n行"');
    });
});

// =====================================================================
// D. 选项
// =====================================================================
group('D. 选项', function () {
    test('emptyLabel 可自定义', function () {
        const csv = buildSeatCsv({
            rows: 1, cols: 2, seats: [null, null], students: [],
            emptyLabel: '空', includePodium: false, includeHeader: false
        });
        assertEq(csv, '第1排,空,空');
    });

    test('includePodium=false 不输出讲台行(两种视角)', function () {
        [studentViewCsv({ includePodium: false }), teacherViewCsv({ includePodium: false })]
            .forEach(function (csv) {
                assert(csv.indexOf('讲台') === -1, '不应含讲台');
            });
    });

    test('includeHeader=false 不输出列号表头(行标签保留)', function () {
        const csv = studentViewCsv({ includeHeader: false, includePodium: false });
        assertEq(csv.split('\r\n'), ['第1排,张三,李四,', '第2排,王五,,赵六']);
    });
});

// =====================================================================
// E. 边界
// =====================================================================
group('E. 边界', function () {
    test('rows=0 只有讲台/表头', function () {
        const csv = buildSeatCsv({ rows: 0, cols: 3, seats: [], students: [] });
        assertEq(csv.split('\r\n'), ['讲台,,,', '排\\列,第1列,第2列,第3列']);
    });

    test('cols=0 不崩溃', function () {
        const csv = buildSeatCsv({ rows: 1, cols: 0, seats: [], students: [] });
        assertEq(csv.split('\r\n'), ['讲台', '排\\列', '第1排']);
    });

    test('seats 长度不足 → 缺的座位当空', function () {
        const csv = buildSeatCsv({
            rows: 2, cols: 2, seats: ['s1'], students: STUDENTS,
            includePodium: false, includeHeader: false
        });
        assertEq(csv.split('\r\n'), ['第1排,张三,', '第2排,,']);
    });

    test('未知 studentId → 空名字(不报错)', function () {
        const csv = buildSeatCsv({
            rows: 1, cols: 1, seats: ['ghost'], students: [],
            includePodium: false, includeHeader: false
        });
        assertEq(csv, '第1排,');
    });

    test('不修改传入的 seats / students', function () {
        const seats = SEATS.slice();
        const students = STUDENTS.map(function (s) { return { id: s.id, name: s.name }; });
        buildSeatCsv({ rows: 2, cols: 3, seats: seats, students: students, viewMode: 'teacher' });
        assertEq(seats, SEATS);
        assertEq(students, STUDENTS);
    });
});

// =====================================================================
// F. 文件名与日期
// =====================================================================
group('F. 文件名与日期', function () {
    const d = new Date(2026, 9, 20); // 本地时间 2026-10-20

    test('formatDateStamp → YYYY-MM-DD', function () {
        assertEq(formatDateStamp(d), '2026-10-20');
    });

    test('合法文件名', function () {
        assertEq(buildSeatCsvFilename('高一(3)班', d), '高一(3)班_座位表_2026-10-20.csv');
    });

    test('Windows 非法字符被替换', function () {
        assertEq(buildSeatCsvFilename('A/B:C*D?E"F<G>H|I\\J', d), 'A_B_C_D_E_F_G_H_I_J_座位表_2026-10-20.csv');
    });

    test('空标题回退为「班级座位表」', function () {
        assertEq(buildSeatCsvFilename('   ', d), '班级座位表_座位表_2026-10-20.csv');
    });

    test('CSV_BOM 是 U+FEFF, 纯函数产物不含 BOM', function () {
        assertEq(CSV_BOM, '\uFEFF');
        assert(CSV_BOM.length === 1, 'BOM 应只有一个字符');
        assert(studentViewCsv().charCodeAt(0) !== 0xFEFF, 'buildSeatCsv 不应自带 BOM');
    });
});

// =====================================================================
// 收尾
// =====================================================================
console.log('\n' + '='.repeat(60));
console.log(`总计: ${__passed__} 通过, ${__failed__} 失败`);
if (__failed__ > 0) {
    console.log('\n失败明细:');
    __failures__.forEach(function (f) {
        console.log(`  - [${f.name || f.group}] ${f.error.message}`);
    });
    process.exit(1);
} else {
    console.log('✅ 全部通过');
    process.exit(0);
}
