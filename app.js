/* 渲染与事件绑定层。所有日期数据来自 window.Cal，这里不做任何日期推算。 */
(function () {
  'use strict';

  var MIN_YEAR = 1900;
  // 库的农历表止于 2101-01-28：实测 2101-01-29 起返回 'undefined月初一'，
  // 夹到 2100-12 才能保证任何一个可达日期都是干净数据。
  var MAX_YEAR = 2100;

  var ROWS = 6;
  var COLS = 7;
  var CELL_SLOTS = ROWS * COLS;

  var banner = document.getElementById('term-banner');
  var grid = document.getElementById('grid');
  var detail = document.getElementById('detail');
  var title = document.getElementById('month-title');
  var prevBtn = document.getElementById('prev-month');
  var nextBtn = document.getElementById('next-month');
  var todayBtn = document.getElementById('go-today');
  var picker = document.getElementById('picker');

  // 面板里的两列只在第一次打开时建：201 个年按钮每次都重建是白干的活。
  var yearColEl = null;
  var monthColEl = null;

  var view = { year: 0, month: 0 };
  var selected = null;

  // 每年一次全年扫描换一次"这年有没有放假安排"的结论，翻页时不再重复扫。
  var arrangementCache = {};

  // calendar.js 对越界年月直接抛错，翻页必须在调它之前把年月夹住，否则点一下就整页空白。
  function clampYear(year, month) {
    if (year < MIN_YEAR) {
      return { year: MIN_YEAR, month: 1 };
    }
    if (year > MAX_YEAR) {
      return { year: MAX_YEAR, month: 12 };
    }
    return { year: year, month: month };
  }

  function hasArrangement(year) {
    if (!Object.prototype.hasOwnProperty.call(arrangementCache, year)) {
      var known = false;
      var cursor = new Date(year, 0, 1);
      while (cursor.getFullYear() === year && !known) {
        var dateStr = Cal.toStr(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
        known = Cal.isOffDay(dateStr) || Cal.isMakeupWorkday(dateStr);
        cursor.setDate(cursor.getDate() + 1);
      }
      arrangementCache[year] = known;
    }
    return arrangementCache[year];
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== null && text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  // 小字优先级：节日 > 节气 > 农历日。清明这类同日时只留红色节日名，节气在详情区还能看到。
  function subText(cell) {
    if (cell.holiday.length > 0) {
      // 两个节日撞一天时用「·」并排，窄格子里也比顿号好认。
      return { text: cell.holiday.join('·'), className: 'cell-sub sub-holiday' };
    }
    if (cell.term) {
      return { text: cell.term, className: 'cell-sub sub-term' };
    }
    return { text: cell.lunarText, className: 'cell-sub' };
  }

  // 「这天有没有日程」的判定只留这一处：建格和增删后就地更新共用它，
  // 两边各写一遍的话，刷新前后圆点会不会出现就可能不一致。
  function hasSchedule(date) {
    return Schedule.list(date).length > 0;
  }

  // 添加/删除后只改那一格，不重建网格：重建会把焦点甩回 body，输入框刚打的字就丢了。
  function updateCellDot(date) {
    var cell = grid.querySelector('.cell[data-date="' + date + '"]');
    if (!cell) {
      // 选中日必然在当前 42 格里，查不到只能是回调拿到了别的月份的日期，忽略即可。
      return;
    }
    var has = hasSchedule(date);
    cell.classList.toggle('cell-has-sched', has);
    var dot = cell.querySelector('.cell-dot');
    if (has && !dot) {
      cell.appendChild(el('span', 'cell-dot'));
    } else if (!has && dot) {
      cell.removeChild(dot);
    }
  }

  function buildCell(cell) {
    var button = el('button', 'cell');
    button.type = 'button';
    button.dataset.date = cell.date;
    if (cell.isOff) {
      button.classList.add('cell-off');
    }
    if (cell.isToday) {
      button.classList.add('cell-today');
    }
    if (cell.date === selected) {
      button.classList.add('cell-selected');
      button.setAttribute('aria-current', 'date');
    }

    button.appendChild(el('span', 'cell-day', String(cell.day)));

    var sub = subText(cell);
    button.appendChild(el('span', sub.className, sub.text));

    // 角标只由 isOff/isMakeup 决定，和底部小字互不影响，两者可以同时出现。
    if (cell.isOff) {
      button.appendChild(el('span', 'badge badge-off', '休'));
    } else if (cell.isMakeup) {
      button.appendChild(el('span', 'badge badge-makeup', '班'));
    }

    // 圆点在最后一位插入：增删日程后 updateCellDot 也按「末尾有没有 .cell-dot」判状态，
    // 两条路径写出的格子结构必须一致，否则刷新前后同一天的圆点会长在不同位置。
    if (hasSchedule(cell.date)) {
      button.classList.add('cell-has-sched');
      button.appendChild(el('span', 'cell-dot'));
    }

    return button;
  }

  function renderHeader() {
    title.textContent = view.year + ' 年 ' + view.month + ' 月';
    prevBtn.disabled = view.year <= MIN_YEAR && view.month <= 1;
    nextBtn.disabled = view.year >= MAX_YEAR && view.month >= 12;
  }

  function renderGrid() {
    var month = Cal.buildMonth(view.year, view.month);
    // 固定 6 行必须凑满 42 格，凑不满说明边界夹紧失效了，宁可抛错也不要少画几天。
    if (month.firstWeekday + month.cells.length > CELL_SLOTS) {
      throw new Error('格子溢出：' + view.year + '-' + view.month + ' 首列 ' + month.firstWeekday + ' 共 ' + month.cells.length + ' 天');
    }
    // 数据出表时库里塞的是 'undefined月初一' 这种脏串，画出脏字比当场报错更难查。
    // 只查 undefined/NaN：term 和 holiday 的正常空值就是 null，拼进串里不算脏。
    for (var c = 0; c < month.cells.length; c++) {
      var cell = month.cells[c];
      var parts = cell.lunarText + '|' + cell.term + '|' + cell.holiday;
      if (/undefined|NaN/.test(parts)) {
        throw new Error('农历/节气数据越界：' + cell.date + ' -> ' + parts);
      }
    }

    var fragment = document.createDocumentFragment();
    var i;
    for (i = 0; i < month.firstWeekday; i++) {
      fragment.appendChild(el('div', 'cell-blank'));
    }
    for (i = 0; i < month.cells.length; i++) {
      fragment.appendChild(buildCell(month.cells[i]));
    }
    for (i = month.firstWeekday + month.cells.length; i < CELL_SLOTS; i++) {
      fragment.appendChild(el('div', 'cell-blank'));
    }

    grid.textContent = '';
    grid.appendChild(fragment);
  }

  function addRow(target, label, value, valueClass) {
    var row = el('div', 'detail-row');
    row.appendChild(el('span', 'detail-label', label));
    row.appendChild(el('span', 'detail-value' + (valueClass ? ' ' + valueClass : ''), value));
    target.appendChild(row);
  }

  // 文案拼在渲染层：calendar.js 只给数字，"今天/几天前/几天后"是要改的措辞，
  // 放进纯日期层就等于把展示规则焊死在数据层，还会牵动冻结的 test.js。
  function distanceText(n) {
    if (n === 0) {
      return '今天';
    }
    // 负数只表示方向，数值一律取绝对值再拼"天前"，读的人不用心算负号。
    return n > 0 ? n + ' 天后' : Math.abs(n) + ' 天前';
  }

  function renderDetail() {
    if (!selected) {
      detail.textContent = '';
      return;
    }
    var info = Cal.getDayInfo(selected);
    var box = document.createDocumentFragment();
    box.appendChild(el('h2', 'detail-title', info.solar + '　' + info.weekday));

    // 放标题之下、农历之上：查日子的人第一眼问的是"离今天多远"。
    // 它只依赖选中日和今天，跟节气/节日/放假有没有值无关，所以不受"空项整行不渲染"规则影响，
    // 任何一天详情区都至少有这么一行。
    addRow(box, '距离今天', distanceText(Cal.dayDistance(selected)));

    addRow(box, '农历', info.lunar);
    addRow(box, '干支', info.ganzhi + ' ' + info.zodiac + '年');
    // 任务要求：为 null / 空串 的项整行不出现，不能拿"无""—"占位。
    if (info.term) {
      addRow(box, '节气', info.term, 'value-term');
      // 提示行紧贴节气行，只在节气日出现；文案表在 calendar.js，这里只管摆位置和不占语义色。
      // 判空是防将来加了节气名却漏配文案，宁可少一行也不要出现空内容的「提示」行。
      var tip = Cal.getTermTip(info.term);
      if (tip) {
        addRow(box, '提示', tip);
      }
    }
    if (info.holiday.length > 0) {
      // 详情区要能看全：同日的两个节日一个都不能省。
      addRow(box, '节日', info.holiday.join('、'), 'value-holiday');
    }

    var year = Number(selected.slice(0, 4));
    if (!hasArrangement(year)) {
      // 文案要分方向：2027 之后是"还没公布"，2004 之前是"库里没收录"，
      // 拿"未公布"描述 1995 会把数据缺失说成官方失责。阈值来自实测的库覆盖区间 2004-2027。
      var hint = year > 2027 ? '该年放假安排未公布' : '本库未收录该年放假安排';
      addRow(box, '放假', hint, 'value-note');
    } else if (info.isOff) {
      addRow(box, '放假', '休 · 法定放假日', 'value-holiday');
    } else if (info.isMakeup) {
      addRow(box, '放假', '班 · 周末补班', 'value-makeup');
    }

    // 日程永远排最后一行：查日子的人先要日期信息，日程是选中这天之后才发生的操作。
    box.appendChild(buildSched(selected));

    detail.textContent = '';
    detail.appendChild(box);
  }

  /* 日程区块。添加和删除只改自己那一行 DOM，不调 renderDetail：
     详情区整体重渲染会把输入框换成新节点，焦点必然丢，连着记几条就变成每加一条重点一次输入框。
     整体重渲染只发生在切换选中日和导入之后。 */

  // 删除时从 NodeList 里现算自己那一行的下标，不记在 dataset 上：
  // 删掉中间一行后，后面每行的下标全部前移，记在元素上的旧下标会删错条目。
  // DOM 顺序和存储顺序由 addItem 保证一致，现算永远对得上。
  function rowIndex(rows, row) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] === row) {
        return i;
      }
    }
    return -1;
  }

  // file:// 页面能不能触发下载各内核不一致（被拦时 textarea 里就是同一份内容，复制即可）。
  // a 要先进文档 click 才可靠；revoke 延后，立即回收 object URL 会让刚起步的下载断掉。
  function downloadSchedule(text) {
    try {
      var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      var link = el('a');
      link.href = url;
      link.download = 'schedule.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 5000);
    } catch (e) {
      // 下载这一步失败不外抛：只读框已经展开了，用户的出口没被关掉。
    }
  }

  // 导入是批量写入，当月哪些天要出新圆点事先不知道，这里允许整体重绘一次网格；
  // 此刻焦点在文件选择框上，不在日程输入框里，重建不打断输入。
  function applyImport(text) {
    var res = Schedule.fromJSON(text);
    renderGrid();
    renderDetail();
    var sched = detail.querySelector('.sched');
    if (sched) {
      // 提示写一行小字而不是 alert：跟着这次重渲染一起出来，不用另找地方收尾。
      // saved 为 false 时不能再报「导入 N 条」：那 N 条刷新后一条都不会剩下，
      // 真正的原因是本地存储写不进去，报条数会把环境问题说成导入结果。
      var note = res.saved === false
        ? '导入失败：本地存储不可写'
        : '导入 ' + res.added + ' 条，跳过 ' + res.skipped + ' 条重复';
      sched.appendChild(el('div', 'sched-count', note));
    }
  }

  function buildSched(date) {
    var wrap = el('div', 'sched');

    var head = el('div', 'sched-head');
    var countEl = el('span', 'sched-count');
    head.appendChild(el('span', 'sched-title', '日程'));
    head.appendChild(countEl);
    wrap.appendChild(head);

    var inputRow = el('div', 'sched-add');
    var input = el('input', 'sched-input');
    input.type = 'text';
    // maxlength 是唯一的上限闸门（存储层只做 trim，不截长度），别在两个地方写数字。
    input.maxLength = 30;
    input.placeholder = '加一条，30 字以内';
    var addBtn = el('button', 'btn', '添加');
    addBtn.type = 'button';
    inputRow.appendChild(input);
    inputRow.appendChild(addBtn);
    wrap.appendChild(inputRow);

    var foot = el('div', 'sched-foot');
    var exportBtn = el('button', 'btn', '导出');
    exportBtn.type = 'button';
    var importBtn = el('button', 'btn', '导入');
    importBtn.type = 'button';
    var fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json';
    // 真控件收起来，点「导入」时代码触发它：360 的详情区一行只排得下两个短按钮，
    // 原生 file 控件那串"未选择文件"的文字塞不进去。
    fileInput.hidden = true;
    foot.appendChild(exportBtn);
    foot.appendChild(importBtn);
    foot.appendChild(fileInput);
    wrap.appendChild(foot);

    function syncCount() {
      var n = Schedule.list(date).length;
      // 0 条时留空，不写「暂无」也不写「0 条」：标题行已经说明这里是日程，没条目就是没内容。
      countEl.textContent = n > 0 ? n + ' 条' : '';
    }

    function exportOut() {
      return wrap.querySelector('.sched-out');
    }

    // 导出框展开着的时候改了数据，内容要跟着刷新，否则用户复制走的是旧 JSON。
    function syncExportOut() {
      var out = exportOut();
      if (out) {
        out.value = Schedule.toJSON();
      }
    }

    function addItem(text) {
      var row = el('div', 'sched-item');
      row.appendChild(el('span', 'sched-text', text));
      var del = el('button', 'sched-del', '×');
      del.type = 'button';
      del.title = '删除这条日程';
      del.addEventListener('click', function () {
        removeItem(row);
      });
      row.appendChild(del);
      // 存储里新条目进末尾，DOM 里也必须落末尾（插在输入行之前）：
      // 两边顺序一错开，下一次删除就会命中隔壁那条。
      wrap.insertBefore(row, inputRow);
    }

    function removeItem(row) {
      if (!window.confirm('删除这条日程？')) {
        return;
      }
      var index = rowIndex(wrap.querySelectorAll('.sched-item'), row);
      if (index < 0 || Schedule.removeAt(date, index) === false) {
        // 存储没改成，界面就一个字都不动：留一条刷新后会消失的日程最容易误导人。
        return;
      }
      wrap.removeChild(row);
      syncCount();
      updateCellDot(date);
      syncExportOut();
    }

    function commitAdd() {
      var text = input.value;
      if (Schedule.add(date, text) === false) {
        // 空文本或当天已有同文本：内容原样留着让人改，只把焦点还回输入框。
        input.focus();
        return;
      }
      addItem(text.trim());
      input.value = '';
      input.focus();
      syncCount();
      updateCellDot(date);
      syncExportOut();
    }

    addBtn.addEventListener('click', commitAdd);

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        commitAdd();
      }
    });

    exportBtn.addEventListener('click', function () {
      var json = Schedule.toJSON();
      var opened = exportOut();
      if (opened) {
        // 再点一次是收起，不再触发第二份下载。
        wrap.removeChild(opened);
        return;
      }
      var out = el('textarea', 'sched-out');
      out.readOnly = true;
      out.value = json;
      wrap.appendChild(out);
      downloadSchedule(json);
    });

    importBtn.addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        applyImport(String(reader.result));
      };
      reader.onerror = function () {
        // 读不出内容时同样用一行小字交代，不弹框。
        wrap.appendChild(el('div', 'sched-count', '导入失败：文件读不出来'));
      };
      reader.readAsText(file);
    });

    var items = Schedule.list(date);
    for (var i = 0; i < items.length; i++) {
      addItem(items[i]);
    }
    syncCount();

    return wrap;
  }

  // 月份→季节只能摊成一张 12 格的表：写成 3<=m<=5 这类区间判断，
  // 改季节边界要动分支，而且 12 月归冬还是归秋在代码里根本看不出来。
  // 下标 0 是 1 月，表长必须 12，越界会写出 undefined。
  var SEASON_BY_MONTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
    'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

  function applySeason() {
    // 跟着"正在看的那个月"换色，不跟着今天换：12 月里翻去 6 月，用户查的是夏天的日子，
    // 底色就该是夏天的；色调本身在 style.css 的 body[data-season] 里，这里不写颜色。
    document.body.dataset.season = SEASON_BY_MONTH[view.month - 1];
  }

  // 节气名→图名摊成一张写死的表，不按拼音现拼：assets/terms/ 里的文件名是画出来的产出物，
  // 拼出来的键和磁盘上的名字错一个字母，横幅就只剩空白，而且看不出是哪儿错的。
  var TERM_FILE = {
    '立春': 'lichun.svg',
    '雨水': 'yushui.svg',
    '惊蛰': 'jingzhe.svg',
    '春分': 'chunfen.svg',
    '清明': 'qingming.svg',
    '谷雨': 'guyu.svg',
    '立夏': 'lixia.svg',
    '小满': 'xiaoman.svg',
    '芒种': 'mangzhong.svg',
    '夏至': 'xiazhi.svg',
    '小暑': 'xiaoshu.svg',
    '大暑': 'dashu.svg',
    '立秋': 'liqiu.svg',
    '处暑': 'chushu.svg',
    '白露': 'bailu.svg',
    '秋分': 'qiufen.svg',
    '寒露': 'hanlu.svg',
    '霜降': 'shuangjiang.svg',
    '立冬': 'lidong.svg',
    '小雪': 'xiaoxue.svg',
    '大雪': 'daxue.svg',
    '冬至': 'dongzhi.svg',
    '小寒': 'xiaohan.svg',
    '大寒': 'dahan.svg'
  };

  // 两个节气最长相隔约 15.7 天，从月首往前 20 天必定落进上一个节气里；
  // 再远就跨回更早的季节，横幅画的是"眼下这半个月"，拿一张对不上日子的图比没图更糟。
  var TERM_LOOKBACK_DAYS = 20;

  var bannerName = null;
  var bannerSub = null;
  // bannerShownKey 是"已经铺上去/已经认过的那张"，bannerWanted 是"最后一次发出的请求"。
  // 前者挡重复加载，后者挡晚到的旧回调，两件事不能共用一个变量。
  var bannerShownKey = '';
  var bannerWanted = '';

  function findViewTerm() {
    // 起点跟"选中的那一天"，不跟当月 1 号：横幅讲的是"这一天落在哪个节气里"，
    // 锚在月首时一个月只可能命中一个节气，24 张图只有 12 张排得上，月末还停在半个月前的图上
    //（11-25 仍显示霜降）。selected 是 'YYYY-MM-DD' 字符串，按位拆数而不是 new Date(str)：
    // 不带时区的 ISO 串有的引擎按 UTC 解析，取到的日号会差一天。
    // selected 由 selectForView（goTo→render 的唯一入口）和网格点击先行赋值，这里不再判空。
    var day = new Date(
      Number(selected.slice(0, 4)),
      Number(selected.slice(5, 7)) - 1,
      Number(selected.slice(8, 10))
    );
    for (var i = 0; i <= TERM_LOOKBACK_DAYS; i++) {
      // 往前探到 1900 年就收手：calendar.js 对 1900 年之前的部分日期直接抛"农历数据缺失"
      //（1899-12-20 实测抛错，1899-12-31 又能返回结果），而这是整条渲染链上唯一会抛的调用，
      // 不挡的话在年月面板里选到 1900 年 1 月就是整页空白。
      if (day.getFullYear() < MIN_YEAR) {
        return null;
      }
      var info = Cal.getDayInfo(Cal.toStr(day.getFullYear(), day.getMonth() + 1, day.getDate()));
      if (info && info.term) {
        // 表里没有这个名字就当作"这个月没图"，整块收起，而不是继续往前找一张更早节气的图：
        // 名字和图错开，显示出来的日期就成假的了。
        if (!Object.prototype.hasOwnProperty.call(TERM_FILE, info.term)) {
          return null;
        }
        return {
          name: info.term,
          file: TERM_FILE[info.term],
          // 月日不补零：这里跟的是中文读法，"11月7日"而不是"11月07日"。
          label: (day.getMonth() + 1) + '月' + day.getDate() + '日 起'
        };
      }
      day.setDate(day.getDate() - 1);
    }
    return null;
  }

  function hideBannerArt() {
    // "这个月没节气"和"图没了"是同一种收尾，必须走同一段代码：
    // 首版两处各写各的，结果一处留了背景、一处留了空文字。
    // bannerWanted 要在这里清掉，否则上一张还在飞的探图回来时，
    // onload 的守卫会以为它仍是最后一次请求，把刚收起来的横幅又露出来（挂的是上个节气的日子）。
    bannerWanted = '';
    // 缺图/无节气就整块 hidden：[hidden] 走 display:none，不占位，日历回到原来的位置。
    // bannerShownKey 停在本次请求值，这一个月不会再反复重试同一张坏图。
    // 画片和文字连容器一起摘掉，只留 HTML 里那个空 div：块虽然藏着，
    // 留着上一个节气的日期就是假信息，一旦以后有什么把它露出来就直接展示错的日子。
    banner.style.backgroundImage = 'none';
    banner.textContent = '';
    bannerName = null;
    bannerSub = null;
    banner.hidden = true;
  }

  function updateTermBanner() {
    var hit = findViewTerm();
    var key = hit ? hit.file + '|' + hit.label : '';
    // 同一张图不重走加载：翻月时横幅多半还停在同一个节气上，
    // 再赋一次 background 会让已经显示的图先空一帧再回来，看着就是闪一下。
    if (key === bannerShownKey) {
      return;
    }
    bannerShownKey = key;
    if (!hit) {
      hideBannerArt();
      return;
    }
    bannerWanted = hit.file;
    // 先用 Image 探一次再上色：直接改 background 时浏览器不报任何错，
    // 缺图会留下一块空横幅占着位置，比整块收起来更像页面坏了。
    var probe = new Image();
    probe.onload = function () {
      // 只认最后一次请求：连翻几个月时先发的请求可能后回来，
      // 不挡就会把上一个节气的图铺到新文字底下。
      if (bannerWanted !== hit.file) {
        return;
      }
      if (!bannerName) {
        var box = el('div', 'term-banner-text');
        bannerName = el('div', 'term-banner-name');
        bannerSub = el('div', 'term-banner-sub');
        box.appendChild(bannerName);
        box.appendChild(bannerSub);
        banner.appendChild(box);
      }
      bannerName.textContent = hit.name;
      bannerSub.textContent = hit.label;
      banner.style.backgroundImage = 'url("assets/terms/' + hit.file + '")';
      banner.hidden = false;
    };
    probe.onerror = function () {
      if (bannerWanted !== hit.file) {
        return;
      }
      hideBannerArt();
    };
    probe.src = 'assets/terms/' + hit.file;
  }

  function render() {
    // 换季挂在这一个口子上：上下月、年月面板、今天、触摸滑动、初始加载五条路径全汇到
    // goTo→render，别处再各写一遍迟早漏掉一条（漏了就表现为底色不跟月走）。
    // 节气横幅同理：它跟的也是"正在看的那个月"，和换季共用这一个口子才不会翻月漏刷。
    applySeason();
    updateTermBanner();
    renderHeader();
    renderGrid();
    renderDetail();
  }

  // 换月时把选中日跟到新月份（当天在新月就选当天，否则选 1 号），
  // 否则停在旧日期上，详情区和当前月对不上，2028 之后的"未公布"提示也不会出现。
  function selectForView() {
    var todayStr = Cal.today();
    if (todayStr.slice(0, 7) === Cal.toStr(view.year, view.month, 1).slice(0, 7)) {
      selected = todayStr;
      return;
    }
    selected = Cal.toStr(view.year, view.month, 1);
  }

  function goTo(year, month) {
    var next = clampYear(year, month);
    view.year = next.year;
    view.month = next.month;
    selectForView();
    render();
  }

  function shiftMonth(delta) {
    var year = view.year;
    var month = view.month + delta;
    if (month < 1) {
      month = 12;
      year -= 1;
    } else if (month > 12) {
      month = 1;
      year += 1;
    }
    goTo(year, month);
  }

  prevBtn.addEventListener('click', function () {
    shiftMonth(-1);
  });

  nextBtn.addEventListener('click', function () {
    shiftMonth(1);
  });

  todayBtn.addEventListener('click', function () {
    var now = new Date();
    goTo(now.getFullYear(), now.getMonth() + 1);
  });

  // 四个季节图案画在同一个 SVG 里、按 <g> 分组，显隐交给 style.css 的 body[data-season]：
  // 翻月只换属性不重建 DOM，也就不会出现新图案已插上、旧图案还没走的重叠帧。
  // 描边走 currentColor，颜色由 .season-deco 的 color 从 --season-accent 取，JS 里不写色值。
  // 标记用 innerHTML 一次性塞进去：HTML 解析器自己会把 <svg> 归进 SVG 命名空间，
  // 换成 createElementNS 就得在 JS 里带上 xmlns 的那条 http 字符串，禁引扫描里看着像外链。
  var SEASON_DECO_MARKUP =
    '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<g class="deco-spring"><path d="M16 27v-10" />' +
    '<path d="M16 17C16 12 12.5 8.5 7.5 8.5 7.5 13.5 11 17 16 17z" />' +
    '<path d="M16 14c0-4.5 3.2-8 8-8 0 4.5-3.2 8-8 8z" /></g>' +
    '<g class="deco-summer"><circle cx="16" cy="16" r="5.5" />' +
    '<path d="M16 3.5v3.2M16 25.3v3.2M3.5 16h3.2M25.3 16h3.2M8.2 8.2l2.3 2.3' +
    'M21.5 21.5l2.3 2.3M23.8 8.2l-2.3 2.3M10.5 21.5l-2.3 2.3" /></g>' +
    '<g class="deco-autumn"><path d="M10.5 21.5C10.5 13 16.5 7 25 7c0 8.5-6 14.5-14.5 14.5z" />' +
    '<path d="M11.5 20.5c3.5-3.5 7.5-8 10.5-11.5" /><path d="M10.5 21.5l-4 4" /></g>' +
    '<g class="deco-winter"><path d="M16 5V27M25.53 10.5L6.47 21.5M25.53 21.5L6.47 10.5M16 9L12.25 6.73M16 9L19.75 6.73M22.06 12.5L22.16 8.12M22.06 12.5L25.9 14.61M22.06 19.5L25.9 17.39M22.06 19.5L22.16 23.88M16 23L19.75 25.27M16 23L12.25 25.27M9.94 19.5L9.84 23.88M9.94 19.5L6.1 17.39M9.94 12.5L6.1 14.61M9.94 12.5L9.84 8.12" /></g>' +
    '</svg>';

  // 顶栏是 index.html 里唯一的静态骨架，本轮它不许动，所以装饰由这里插上；
  // 插在 goTo 之前，首帧就带着正确的季节图案，不会先空一块再补上。
  function buildSeasonDeco() {
    var deco = el('div', 'season-deco');
    deco.innerHTML = SEASON_DECO_MARKUP;
    document.querySelector('.cal-bar').appendChild(deco);
  }

  function buildPicker() {
    yearColEl = el('div', 'picker-col picker-col-year');
    monthColEl = el('div', 'picker-col picker-col-month');
    yearColEl.appendChild(el('div', 'picker-head', '年'));
    monthColEl.appendChild(el('div', 'picker-head', '月'));
    var y = MIN_YEAR;
    for (; y <= MAX_YEAR; y++) {
      var yearItem = el('button', 'picker-item', y + ' 年');
      yearItem.type = 'button';
      yearItem.dataset.year = String(y);
      yearColEl.appendChild(yearItem);
    }
    var m = 1;
    for (; m <= 12; m++) {
      var monthItem = el('button', 'picker-item', m + ' 月');
      monthItem.type = 'button';
      monthItem.dataset.month = String(m);
      monthColEl.appendChild(monthItem);
    }
    picker.appendChild(yearColEl);
    picker.appendChild(monthColEl);
  }

  function markCurrent() {
    var groups = [yearColEl.querySelectorAll('.picker-item'), monthColEl.querySelectorAll('.picker-item')];
    var keys = ['year', 'month'];
    for (var g = 0; g < groups.length; g++) {
      for (var i = 0; i < groups[g].length; i++) {
        var item = groups[g][i];
        item.classList.toggle('picker-current', item.dataset[keys[g]] === String(view[keys[g]]));
      }
    }
  }

  function openPicker() {
    if (!yearColEl) {
      buildPicker();
    }
    markCurrent();
    picker.hidden = false;
    title.setAttribute('aria-expanded', 'true');
    // 年列从 1900 排起，不定位的话一打开是一片和当前月无关的早年。
    // 算 scrollTop 而不用 scrollIntoView：后者会连带把整页滚到面板位置，详情区直接被顶出屏幕。
    var current = yearColEl.querySelector('.picker-current');
    yearColEl.scrollTop = Math.max(0, current.offsetTop - yearColEl.clientHeight / 2);
  }

  function closePicker() {
    picker.hidden = true;
    title.setAttribute('aria-expanded', 'false');
  }

  title.addEventListener('click', function () {
    if (picker.hidden) {
      openPicker();
    } else {
      closePicker();
    }
  });

  picker.addEventListener('click', function (event) {
    var item = event.target.closest('.picker-item');
    if (!item) {
      return;
    }
    // 年月两列各自独立生效：点年沿用当前月，点月沿用当前年，选完立刻跳并关面板。
    if (item.dataset.year) {
      goTo(Number(item.dataset.year), view.month);
    } else {
      goTo(view.year, Number(item.dataset.month));
    }
    closePicker();
  });

  // 文档级监听要认出"这一跳是点标题开的面板"，否则标题的 click 冒泡上来会把自己刚开的面板立刻关掉。
  document.addEventListener('click', function (event) {
    if (picker.hidden) {
      return;
    }
    var target = event.target;
    if (picker.contains(target) || title.contains(target)) {
      return;
    }
    closePicker();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !picker.hidden) {
      closePicker();
    }
  });

  // 事件挂在网格容器上：格子每次翻页全量重建，逐个绑定会不断堆积监听。
  grid.addEventListener('click', function (event) {
    var cell = event.target.closest('.cell');
    if (!cell || !cell.dataset.date) {
      return;
    }
    selected = cell.dataset.date;
    // 选中态就地挪，不重建整张网格：重建会把键盘焦点甩回 body，Tab+Enter 连点两个日期就断了。
    var old = grid.querySelector('.cell-selected');
    if (old) {
      old.classList.remove('cell-selected');
      old.removeAttribute('aria-current');
    }
    cell.classList.add('cell-selected');
    cell.setAttribute('aria-current', 'date');
    renderDetail();
    // 横幅跟着选中的日子走，所以选中一变就得重取一次。这里不走 render()：
    // 它会 renderGrid() 重建整张网格，键盘焦点被甩回 body，Tab+Enter 连点两个日期就断了；
    // updateTermBanner 自己有 bannerShownKey 去重，点到同一个节气里的另一天不会重新铺图，不会闪。
    updateTermBanner();
  });

  /* 触摸左右滑翻月。三个监听器都绑在 #grid 的冒泡阶段：只有起点落在网格里的手势才进得来，
     picker 面板和顶栏不是网格的后代，命中测试就把它们的手势挡在外面，不用再判 target；
     捕获阶段能收到的范围完全一样，没必要抢在格子自己的处理之前。
     判定只放在 touchend：touchmove 会以几十 Hz 连续上报，在 move 里翻的话一次划动能连翻好几页；
     等抬手再判，用户中途把手指划回竖直方向还来得及作废。
     三个都显式 passive:true：这里不 preventDefault（页面竖向滚动必须归浏览器），
     声明 passive 是提前告诉浏览器"这个监听器不会拦默认动作"，滚动合成就不用等 JS 返回。 */
  var SWIPE_MIN_X = 50;

  // 一次手势的状态：起点 + 起点那根手指的 id + 是否已被判成竖向滚动。
  var swipe = null;

  function findTouch(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier === id) {
        return list[i];
      }
    }
    return null;
  }

  grid.addEventListener('touchstart', function (event) {
    // 只在"当前只有一根手指按着"时起算：后落下的第二根手指不能挪走基准点，
    // 否则两指间距会被当成横向位移；而上一场手势若被 touchcancel 打断没走到 touchend，
    // 下一次单指按下会直接覆盖脏基准，不会留下状态挡住后面的手势。
    if (event.touches.length !== 1) {
      return;
    }
    var touch = event.changedTouches[0];
    swipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY, vertical: false };
  }, { passive: true });

  grid.addEventListener('touchmove', function (event) {
    if (!swipe) {
      return;
    }
    var touch = findTouch(event.changedTouches, swipe.id);
    if (!touch) {
      return;
    }
    // 竖直位移一旦压过横向就整场作废（之后横着漂回来也不翻）：
    // 用户这是在日历上滚页面，手指划弧带出的横向分量不是翻页意图。
    if (Math.abs(touch.clientY - swipe.y) > Math.abs(touch.clientX - swipe.x)) {
      swipe.vertical = true;
    }
  }, { passive: true });

  grid.addEventListener('touchend', function (event) {
    if (!swipe) {
      return;
    }
    var touch = findTouch(event.changedTouches, swipe.id);
    // 抬起来的不一定是起算那根手指（掌心先离开的那根往往不是划动的那根），
    // 不是基准指就原样保留手势状态，等基准指抬起时再判一次。
    if (!touch) {
      return;
    }
    var gesture = swipe;
    // 基准指抬起即清空状态：一次手势最多翻一页，另一根手指随后抬起时状态已空，不会再翻。
    swipe = null;
    if (gesture.vertical) {
      return;
    }
    var dx = touch.clientX - gesture.x;
    var dy = touch.clientY - gesture.y;
    // 抬手时再比一次 |dy| 与 |dx|：快速甩动可能只上报最后一个坐标，
    // move 里没来得及登记的竖直意图靠这次兜住；阈值用绝对值比较，要求 |dx| > 50。
    if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) <= SWIPE_MIN_X) {
      return;
    }
    // 翻月只走顶栏按钮同一个入口：跨年、1900/2100 夹取、按钮 disabled 重算都在 shiftMonth→goTo 里，
    // 手势不再自己算年月，所以在 1900-01 右滑会被夹回原地，不会滑出界。
    shiftMonth(dx < 0 ? 1 : -1);
  }, { passive: true });

  var boot = new Date();
  buildSeasonDeco();
  goTo(boot.getFullYear(), boot.getMonth() + 1);
})();
