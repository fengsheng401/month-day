/* 零依赖自检：node test.js。全绿才允许动页面文件。 */
'use strict';

var Cal = require('./calendar.js');

var passed = 0;
var total = 0;

function check(label, expected, actual) {
  total++;
  if (expected === actual) {
    passed++;
    console.log('√ ' + label);
  } else {
    console.log('× ' + label + ' | 期望: ' + JSON.stringify(expected) + ' | 实际: ' + JSON.stringify(actual));
  }
}

// 1
var nov = Cal.buildMonth(2026, 11);
check('1. buildMonth(2026, 11).days === 30', 30, nov.days);

// 2
check("2. getDayInfo('2026-01-01').weekday === '星期四'", '星期四', Cal.getDayInfo('2026-01-01').weekday);

// 3
check("3. getDayInfo('2026-02-17').lunar === '正月初一'", '正月初一', Cal.getDayInfo('2026-02-17').lunar);

// 4
check("4. getDayInfo('2026-02-17').holiday 含 '春节'", true, Cal.getDayInfo('2026-02-17').holiday.indexOf('春节') > -1);

// 5
check("5. getDayInfo('2026-09-25').lunar === '八月十五'", '八月十五', Cal.getDayInfo('2026-09-25').lunar);

// 6
check("6. getDayInfo('2026-09-25').holiday 含 '中秋'", true, Cal.getDayInfo('2026-09-25').holiday.indexOf('中秋') > -1);

// 7
check("7. getDayInfo('2026-04-05').term === '清明'", '清明', Cal.getDayInfo('2026-04-05').term);

// 8
check("8. getDayInfo('2026-12-22').term === '冬至'", '冬至', Cal.getDayInfo('2026-12-22').term);

// 9 走我们自己的取数路径统计，顺带验证按年缓存没漏节气
var termCount = 0;
var cursor = new Date(2026, 0, 1);
while (cursor.getFullYear() === 2026) {
  if (Cal.getTerm(Cal.toStr(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate())) !== null) {
    termCount++;
  }
  cursor.setDate(cursor.getDate() + 1);
}
check('9. 2026 年节气总数为 24 条', 24, termCount);

// 10
check("10. getDayInfo('2026-10-01').isOff === true", true, Cal.getDayInfo('2026-10-01').isOff);

// 11
check("11. getDayInfo('2026-01-04').isMakeup === true", true, Cal.getDayInfo('2026-01-04').isMakeup);

// 12 逐月遍历全年格子，农历文本必须是干净中文
var lunarIssues = [];
var cellCount = 0;
for (var m = 1; m <= 12; m++) {
  var month = Cal.buildMonth(2026, m);
  for (var i = 0; i < month.cells.length; i++) {
    cellCount++;
    var text = month.cells[i].lunarText;
    for (var bad = 0; bad < 3; bad++) {
      var mark = ['undefined', 'NaN', 'null'][bad];
      if (typeof text !== 'string' || text.indexOf(mark) > -1) {
        lunarIssues.push(month.cells[i].date + ' -> ' + JSON.stringify(text));
        break;
      }
    }
  }
}
check('12. 2026 全年 365 格 lunarText 无 undefined/NaN/null', '365 格全部干净',
  cellCount === 365 && lunarIssues.length === 0 ? '365 格全部干净' : lunarIssues.slice(0, 3).join(' , ') + ' (共 ' + cellCount + ' 格)');

/* 13-16 的 require 放在这里而不是文件顶部：断言 1-12 已冻结，唯一可用的插入位置是 12 之后、
   汇总那行之前——汇总必须继续留在最后，否则 passed/total 只数得到前 12 条。 */
var Schedule = require('./storage.js');

// check 用 === 比较，两个对象字面量永远不相等，所以对象断言两边都比 JSON.stringify。
// 四条输入的键序都只有一个键，期望串照需求原文写死即可，不用担心键序歧义。

// 13
check('13. normalize({}) 深等于 {}', '{}', JSON.stringify(Schedule.normalize({})));

// 14 值必须是数组，字符串值整键丢掉
check('14. normalize({"2026-01-01":"x"}) 深等于 {}', '{}', JSON.stringify(Schedule.normalize({ '2026-01-01': 'x' })));

// 15 键不匹配 YYYY-MM-DD 就丢掉
check('15. normalize({"bad":["a"]}) 深等于 {}', '{}', JSON.stringify(Schedule.normalize({ bad: ['a'] })));

// 16 非字符串元素、空串、纯空白都丢掉；同文本按 trim 后的结果去重
check('16. normalize 丢非法项并去重', '{"2026-01-01":["a"]}',
  JSON.stringify(Schedule.normalize({ '2026-01-01': ['a', 123, '', 'a', '  '] })));

console.log('通过 ' + passed + ' / ' + total);
if (passed !== total) {
  process.exitCode = 1;
}
