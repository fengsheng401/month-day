/* 日程数据层：只读写 localStorage 里的 { 'YYYY-MM-DD': ['文本'] } 平表，不碰 DOM。
   同文件要能在浏览器和 node 两种宿主下跑：test.js 用 require 拿到的是页面真正执行的同一份实现，
   规则不会两边各写一遍再漂掉。 */
(function () {
  'use strict';

  var KEY = 'calendar.schedule.v1';
  // 键必须是 YYYY-MM-DD：存储是平表，键写歪的条目永远查不回来，只能在清洗阶段丢掉。
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // 只在函数被调用时才取 localStorage：模块加载时 node 里没有这个全局，
  // 顶层碰一次就让整个文件 require 失败。禁用本地存储的浏览器里读这个属性本身也会抛。
  function storage() {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch (e) {
      return null;
    }
  }

  function isPlain(obj) {
    return Object.prototype.toString.call(obj) === '[object Object]';
  }

  // stats 传对象时顺手记录被丢掉的条数，给 fromJSON 算 skipped。传 null 就是 normalize 自己用。
  // 清洗规则只留这一份实现：导入若和 load 用的规则不一致，就能往存储里写进读不回来的数据。
  function normalizeInto(obj, stats) {
    var out = {};
    if (!isPlain(obj)) {
      return out;
    }
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var date = keys[i];
      var value = obj[date];
      if (!DATE_RE.test(date) || !Array.isArray(value)) {
        if (stats) {
          stats.skipped += 1;
        }
        continue;
      }
      var kept = [];
      for (var j = 0; j < value.length; j++) {
        var raw = value[j];
        // 存 trim 后的文本：add 也是 trim 后比对，留着空格会让"同一条日程"在库里长两个样。
        var text = typeof raw === 'string' ? raw.trim() : '';
        if (text === '' || kept.indexOf(text) > -1) {
          if (stats) {
            stats.skipped += 1;
          }
          continue;
        }
        kept.push(text);
      }
      // 清洗后见底的键整条丢掉：removeAt 删空也是删键，同一件事在库里只留一种表示。
      if (kept.length > 0) {
        out[date] = kept;
      }
    }
    return out;
  }

  function normalize(obj) {
    return normalizeInto(obj, null);
  }

  function load() {
    var store = storage();
    if (!store) {
      return {};
    }
    var rawValue;
    try {
      rawValue = store.getItem(KEY);
    } catch (e) {
      return {};
    }
    if (typeof rawValue !== 'string') {
      return {};
    }
    try {
      return normalizeInto(JSON.parse(rawValue), null);
    } catch (e) {
      // 手工改坏或写到一半的非法 JSON 只让日程退回空表，不能把整页渲染一起带走。
      return {};
    }
  }

  function save(map) {
    var store = storage();
    if (!store) {
      return false;
    }
    try {
      // 写前再清洗一遍：storage.js 之外（控制台手改、别的脚本）动过的数据也过同一道门。
      store.setItem(KEY, JSON.stringify(normalizeInto(map, null)));
      return true;
    } catch (e) {
      // 配额满或被策略禁用时 setItem 会抛；吞掉返回 false，日程存不上不该影响查日期。
      return false;
    }
  }

  function list(date) {
    // 键先过 DATE_RE 再查：不挡的话 list('constructor') 会摸到 Object 原型上的函数，
    // 后面 .slice(0) 直接 TypeError；合法键里也只会是清洗过的数组。
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      return [];
    }
    var map = load();
    // hasOwnProperty 再兜一层：'__proto__' 这类键即便漏过正则也不该从原型链上取到东西。
    var items = Object.prototype.hasOwnProperty.call(map, date) ? map[date] : null;
    // 返回副本：调用方直接 push 就等于绕过 add 改数据，会表现成"页面上有条目、刷新就没了"。
    return items ? items.slice(0) : [];
  }

  function add(date, text) {
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      return false;
    }
    var value = typeof text === 'string' ? text.trim() : '';
    if (value === '') {
      return false;
    }
    var map = load();
    var items = map[date];
    if (!items) {
      items = map[date] = [];
    } else if (items.indexOf(value) > -1) {
      return false;
    }
    items.push(value);
    // 把 save 的结果原样带出去：存不下就不算"加成功了"，调用方据此决定要不要改界面。
    return save(map);
  }

  function removeAt(date, index) {
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      return false;
    }
    // 下标必须是整数：NaN 比 0 和 length 都小/大都不成立，能穿透原来的两道边界比较，
    // 结果 splice(NaN, 1) 被当成 splice(0, 1)，静默删掉第 0 条还返回 true。
    // Math.floor 这条同时挡住小数和字符串下标（'1' !== 1）。
    if (index !== Math.floor(index)) {
      return false;
    }
    var map = load();
    if (!Object.prototype.hasOwnProperty.call(map, date)) {
      return false;
    }
    var items = map[date];
    if (index < 0 || index >= items.length) {
      return false;
    }
    items.splice(index, 1);
    if (items.length === 0) {
      delete map[date];
    }
    return save(map);
  }

  function toJSON() {
    return JSON.stringify(load(), null, 2);
  }

  function fromJSON(str) {
    // saved 先给 true：解析失败时压根没走到写入，这时候报"存储不可写"会把坏文件说成环境问题。
    var res = { added: 0, skipped: 0, saved: true };
    var parsed;
    try {
      parsed = JSON.parse(str);
    } catch (e) {
      return res;
    }
    // 不合法项和本次输入内部的重复在这里就计进 skipped，和界面提示读到的口径一致。
    var incoming = normalizeInto(parsed, res);
    var map = load();
    var keys = Object.keys(incoming);
    for (var i = 0; i < keys.length; i++) {
      var date = keys[i];
      var items = map[date];
      if (!items) {
        items = map[date] = [];
      }
      var texts = incoming[date];
      for (var j = 0; j < texts.length; j++) {
        if (items.indexOf(texts[j]) > -1) {
          res.skipped += 1;
        } else {
          items.push(texts[j]);
          res.added += 1;
        }
      }
    }
    // 不管有没有新条目都调一次 save：写失败是环境问题，跟这次导入恰好带了几条新东西无关，
    // 只在 added>0 时才试写就会让同样的坏环境有时报得出、有时报不出。
    if (save(map) === false) {
      // 落盘失败时一件都没存上，把已合入的条数退回到 skipped 里：
      // 报「导入 N 条」却一条都存不住，比报 0 条更容易把人带偏。
      res.skipped += res.added;
      res.added = 0;
      res.saved = false;
    }
    return res;
  }

  var api = {
    normalize: normalize,
    load: load,
    save: save,
    list: list,
    add: add,
    removeAt: removeAt,
    toJSON: toJSON,
    fromJSON: fromJSON
  };

  if (typeof window !== 'undefined') {
    window.Schedule = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
