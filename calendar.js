/* 日期计算层：只算数据，不碰 DOM。浏览器挂到 window.Cal，Node 走 module.exports。 */
(function (root, factory) {
  'use strict';

  // 数据源在两种宿主里的拿法不同：Node 只能 require，浏览器靠 index.html 先加载出的全局变量。
  var isCommonJS = typeof module === 'object' && module !== null && !!module.exports;
  var chineseDays = isCommonJS ? require('./vendor/chinese-days.min.js') : root.chineseDays;

  // 缺库时立刻抛出可读错误：日历少数据源只能报错，静默出空表会被当成"计算对了"。
  if (!chineseDays || typeof chineseDays.getLunarDate !== 'function') {
    throw new Error('没找到 chineseDays 数据源：index.html 里 vendor/chinese-days.min.js 必须在 calendar.js 之前引入。');
  }

  var api = factory(chineseDays);

  if (isCommonJS) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.Cal = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (chineseDays) {
  'use strict';

  var WEEKDAY_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function assertDateStr(dateStr) {
    if (typeof dateStr !== 'string' || !DATE_PATTERN.test(dateStr)) {
      throw new Error('dateStr 必须是 YYYY-MM-DD 形式的字符串，收到：' + String(dateStr));
    }
  }

  function assertYearMonth(year, month) {
    if (!(year >= 1 && month >= 1 && month <= 12)) {
      throw new Error('year/month 越界，收到：' + String(year) + '-' + String(month));
    }
  }

  function pad2(n) {
    // 库里所有入参/返回值都用补零的 YYYY-MM-DD，差一个 0 就查不到数据。
    return n < 10 ? '0' + n : String(n);
  }

  function toStr(year, month, day) {
    return year + '-' + pad2(month) + '-' + pad2(day);
  }

  function fromStr(dateStr) {
    assertDateStr(dateStr);
    return {
      year: Number(dateStr.slice(0, 4)),
      month: Number(dateStr.slice(5, 7)),
      day: Number(dateStr.slice(8, 10))
    };
  }

  // 一律用本地时区构造 Date：Date('2026-01-01') 按 UTC 解析，在负时区主机上会整体错一天。
  function localDate(year, month, day) {
    var d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      throw new Error('非法日期：' + toStr(year, month, day));
    }
    return d;
  }

  function weekdayIndex(dateStr) {
    var p = fromStr(dateStr);
    return localDate(p.year, p.month, p.day).getDay();
  }

  /* ---------------- 节气 ---------------- */

  var termIndexByYear = {};

  function termIndexOfYear(year) {
    if (!termIndexByYear[year]) {
      var list = chineseDays.getSolarTerms(toStr(year, 1, 1), toStr(year, 12, 31));
      if (!Array.isArray(list) || list.length !== 24) {
        throw new Error('节气数据异常：' + year + ' 年取到 ' + (list ? list.length : 'null') + ' 条，应为 24 条。');
      }
      var map = {};
      for (var i = 0; i < list.length; i++) {
        if (Object.prototype.hasOwnProperty.call(map, list[i].date)) {
          throw new Error('节气数据异常：' + year + ' 年 ' + list[i].date + ' 重复。');
        }
        map[list[i].date] = list[i].name;
      }
      termIndexByYear[year] = map;
    }
    return termIndexByYear[year];
  }

  function getTerm(dateStr) {
    // 按年缓存：渲染一个月要查 30 次节气，缓存后每年只调一次库。
    var year = fromStr(dateStr).year;
    var map = termIndexOfYear(year);
    return Object.prototype.hasOwnProperty.call(map, dateStr) ? map[dateStr] : null;
  }

  // 文案是固定知识，不是从日期算出来的，所以只能是一张静态表：
  // 24 句排在一起才能一眼看出漏没漏、超没超字数，散进逻辑里现场拼迟早会少几个节气。
  // key 必须与 vendor 返回的节气名逐字相同，差一个字就查不到文案。
  var TERM_TIPS = {
    '立春': '开始回暖了，但别急着减衣服',
    '雨水': '雨水多了，出门带把伞',
    '惊蛰': '春雷渐多，虫子和草都醒了',
    '春分': '昼夜一样长，往后白天越来越长',
    '清明': '多雨又起风，出门加件外套',
    '谷雨': '春天的尾巴，雨多，适合种东西',
    '立夏': '气温上来了，早晚温差还大',
    '小满': '麦子快熟了，但还没到收获的时候',
    '芒种': '收麦插秧两头忙，天也热起来了',
    '夏至': '白天最长，从这天起开始变短',
    '小暑': '天开始闷热，但最热还没到',
    '大暑': '一年里最热的时候，中午少出门',
    '立秋': '暑气没退，但早晚先凉了',
    '处暑': '暑气到头了，早晚明显凉快',
    '白露': '早晚见露水，夜里睡觉盖好被子',
    '秋分': '昼夜又一样长，天干，多喝水',
    '寒露': '更冷了，露水快要结成霜',
    '霜降': '开始下霜，早上地面发白',
    '立冬': '开始冷了，厚衣服可以拿出来',
    '小雪': '开始落雪，不过量还不大',
    '大雪': '雪多起来，路滑出行留神',
    '冬至': '白天最短，往后白天一天天变长',
    '小寒': '一年里最冷的时段开始了',
    '大寒': '最冷的时候到了，年也快到了'
  };

  // 只查表、不抛错：调用方是格子点击链路，传进来的可能是 null（非节气日）或任意字符串，
  // 非节气本来就没有提示，返回 null 让渲染层不画这一行，而不是报错打断整次渲染。
  // 用 hasOwnProperty 而不是直接取值：'constructor'、'toString' 这类原型键名不能当成文案返回。
  function getTermTip(term) {
    if (typeof term !== 'string') {
      return null;
    }
    return Object.prototype.hasOwnProperty.call(TERM_TIPS, term) ? TERM_TIPS[term] : null;
  }

  /* ---------------- 农历 ---------------- */

  function getLunar(dateStr) {
    var lunar = chineseDays.getLunarDate(dateStr);
    if (!lunar || !lunar.lunarMonCN || !lunar.lunarDayCN) {
      throw new Error('农历数据缺失：' + dateStr);
    }
    return lunar;
  }

  function lunarMonthDayText(lunar) {
    // 闰月的 lunarMonCN 不带"闰"字，不补上就分不清闰六月和六月。
    return (lunar.isLeap ? '闰' : '') + lunar.lunarMonCN + lunar.lunarDayCN;
  }

  function lunarCellText(lunar) {
    // 初一那格显示月名，是全月唯一的月份提示，其余日子只给日名，跟纸质日历一致。
    if (lunar.lunarDay === 1) {
      return (lunar.isLeap ? '闰' : '') + lunar.lunarMonCN;
    }
    return lunar.lunarDayCN;
  }

  /* ---------------- 是否休息 / 补班 ---------------- */

  function isOffDay(dateStr) {
    // isHoliday 对普通周六日也返回 true，直接用会把每个双休都标成"法定放假"。
    // 库里节假日安排的 name 形如 "National Day,国庆节,3"，普通日子只有英文星期名，靠逗号区分。
    if (!chineseDays.isHoliday(dateStr)) {
      return false;
    }
    var detail = chineseDays.getDayDetail(dateStr);
    if (!detail || typeof detail.name !== 'string') {
      throw new Error('放假数据缺失：' + dateStr);
    }
    return detail.name.indexOf(',') > -1;
  }

  function isMakeupWorkday(dateStr) {
    // 补班只发生在周末：isWorkday 单独用会把普通工作日也算进去。
    var wd = weekdayIndex(dateStr);
    return (wd === 0 || wd === 6) && chineseDays.isWorkday(dateStr) === true;
  }

  /* ---------------- 节日（只认这七个，名称一律自算，不从库里取） ---------------- */

  // 返回数组而不是单个名字：公历节日和农历节日会撞在同一天（2020-10-01 国庆 + 中秋），
  // 只留一个就把另一边的节日抹掉了。没命中返回空数组，调用方按长度判空。
  function getFestival(dateStr, lunar, term) {
    var p = fromStr(dateStr);
    var names = [];
    if (p.month === 1 && p.day === 1) {
      names.push('元旦');
    }
    if (p.month === 5 && p.day === 1) {
      names.push('劳动节');
    }
    if (p.month === 10 && p.day === 1) {
      names.push('国庆节');
    }
    if (term === '清明') {
      // 清明是唯一按节气定的节日，农历/公历日期每年都飘，只能看节气命中。
      names.push('清明');
    }
    if (!lunar.isLeap) {
      // 闰五月不算端午：置闰月是额外的月份，节令只认正月份。
      if (lunar.lunarMon === 1 && lunar.lunarDay === 1) {
        names.push('春节');
      }
      if (lunar.lunarMon === 5 && lunar.lunarDay === 5) {
        names.push('端午');
      }
      if (lunar.lunarMon === 8 && lunar.lunarDay === 15) {
        names.push('中秋');
      }
    }
    return names;
  }

  /* ---------------- 对外接口 ---------------- */

  function buildMonth(year, month) {
    assertYearMonth(year, month);
    // monthDays 返回的是农历月长度（29/30），公历月长度只能自己按 Date 算。
    localDate(year, month, 1);
    var days = new Date(year, month, 0).getDate();
    var firstWeekday = new Date(year, month - 1, 1).getDay();
    var todayStr = today();
    var termMap = termIndexOfYear(year);
    var cells = [];
    for (var d = 1; d <= days; d++) {
      var dateStr = toStr(year, month, d);
      var lunar = getLunar(dateStr);
      var term = Object.prototype.hasOwnProperty.call(termMap, dateStr) ? termMap[dateStr] : null;
      cells.push({
        date: dateStr,
        day: d,
        lunarText: lunarCellText(lunar),
        term: term,
        holiday: getFestival(dateStr, lunar, term),
        isOff: isOffDay(dateStr),
        isMakeup: isMakeupWorkday(dateStr),
        isToday: dateStr === todayStr
      });
    }
    return { days: days, firstWeekday: firstWeekday, cells: cells };
  }

  function getDayInfo(dateStr) {
    var p = fromStr(dateStr);
    localDate(p.year, p.month, p.day);
    var lunar = getLunar(dateStr);
    var term = getTerm(dateStr);
    var off = isOffDay(dateStr);
    var makeup = isMakeupWorkday(dateStr);
    return {
      solar: p.year + '年' + p.month + '月' + p.day + '日',
      weekday: WEEKDAY_CN[weekdayIndex(dateStr)],
      lunar: lunarMonthDayText(lunar),
      ganzhi: lunar.yearCyl + '年',
      zodiac: lunar.zodiac,
      term: term,
      holiday: getFestival(dateStr, lunar, term),
      note: off ? '休' : (makeup ? '班' : ''),
      isOff: off,
      isMakeup: makeup
    };
  }

  function today() {
    var now = new Date();
    return toStr(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  // 距离今天的天数：正=未来、负=过去、0=今天。只按自然日算，两边先归到本地 00:00 再相减——
  // 不归零的话"今天 23:59 对目标日 00:00"会差出不足一天的零头，取整就飘 1 天。
  // 归零后相减本应正好是 86400000 的整数倍，但本地时区若有夏令时或偏移调整，
  // 跨那两天的日长不是 24 小时，除法会得到 89.958 这类值，所以用 Math.round 兜浮点误差，
  // 不用 floor/ceil——那是在猜误差方向，正负两侧会猜出不同的结果。
  function dayDistance(dateStr) {
    assertDateStr(dateStr);
    var target = fromStr(dateStr);
    var now = fromStr(today());
    // 校验交给 localDate：它已经会对 2026-02-30 这类"形状对但不存在"的日期抛错，这里不重复写一份。
    return Math.round((localDate(target.year, target.month, target.day).getTime()
      - localDate(now.year, now.month, now.day).getTime()) / 86400000);
  }

  return {
    buildMonth: buildMonth,
    getDayInfo: getDayInfo,
    getTerm: getTerm,
    isOffDay: isOffDay,
    isMakeupWorkday: isMakeupWorkday,
    today: today,
    toStr: toStr,
    WEEKDAY_CN: WEEKDAY_CN,
    dayDistance: dayDistance,
    getTermTip: getTermTip
  };
});
