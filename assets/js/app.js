/* ============================================================
   AI转型 —— APP 逻辑（视图导航 + 精简/详细答案 + 随机抽题）
   ============================================================ */
(function () {
  "use strict";
  var DATA = window.APP_DATA || [];
  var LS_FAV = "aiwb_favs_v1";
  var LS_NOTE = "aiwb_notes_v1";
  var LS_STATE = "aiwb_state_v1";
  var LS_ANSMODE = "aiwb_ansmode_v1"; // "concise" | "full"

  // ---- 状态 ----
  var state = {
    view: "main",       // main | quiz | favs
    tab: "knowledge",   // knowledge | interview (main view 内)
    key: null,
    favOnly: false,
    showAns: false,
    ansMode: loadAnsMode()
  };
  var favs = loadJSON(LS_FAV, []);
  var notes = loadJSON(LS_NOTE, {});

  // ---- 抽题状态 ----
  var quiz = {
    items: [],      // 10 个随机面试题
    idx: 0,
    correct: 0,
    wrong: 0,
    revealed: false
  };

  function loadJSON(k, def) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; }
    catch (e) { return def; }
  }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function loadAnsMode() {
    try { return localStorage.getItem(LS_ANSMODE) || "concise"; } catch (e) { return "concise"; }
  }

  function itemsOf(mod) { return state.tab === "knowledge" ? mod.knowledge : mod.interview; }
  function favKey(tab, id) { return tab + "::" + id; }
  function isFav(id) { return favs.indexOf(favKey(state.tab, id)) >= 0; }
  function hasNote(id) { return !!(notes[favKey(state.tab, id)] && notes[favKey(state.tab, id)].trim()); }

  // ---- Markdown 轻量渲染 ----
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function inline(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return s;
  }
  function renderMD(md) {
    if (!md) return "";
    var lines = md.split("\n");
    var html = "", i = 0, para = [];
    function flushPara() {
      if (para.length) { html += "<p>" + para.map(inline).join("<br>") + "</p>"; para = []; }
    }
    while (i < lines.length) {
      var line = lines[i];
      if (line.trim() === "") { flushPara(); i++; continue; }
      if (line.indexOf("```") === 0) {
        flushPara();
        var code = []; i++;
        while (i < lines.length && lines[i].indexOf("```") !== 0) { code.push(lines[i]); i++; }
        i++;
        html += "<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>";
        continue;
      }
      if (line.indexOf("### ") === 0) { flushPara(); html += "<h4>" + inline(line.slice(4)) + "</h4>"; i++; continue; }
      if (line.indexOf("## ") === 0) { flushPara(); html += "<h3>" + inline(line.slice(3)) + "</h3>"; i++; continue; }
      if (line.indexOf("# ") === 0) { flushPara(); html += "<h2>" + inline(line.slice(2)) + "</h2>"; i++; continue; }
      if (line.trim() === "---") { flushPara(); html += "<hr>"; i++; continue; }
      if (line.indexOf(">") === 0) {
        flushPara();
        var bq = [];
        while (i < lines.length && (lines[i].indexOf(">") === 0)) { bq.push(lines[i].replace(/^>\s?/, "")); i++; }
        html += "<blockquote>" + bq.map(inline).join("<br>") + "</blockquote>";
        continue;
      }
      var ulm = line.match(/^\s*[-*]\s+(.*)$/);
      if (ulm) {
        flushPara(); var ul = [];
        while (i < lines.length && (lines[i].match(/^\s*[-*]\s+/))) { ul.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
        html += "<ul>" + ul.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + "</ul>";
        continue;
      }
      var olm = line.match(/^\s*\d+\.\s+(.*)$/);
      if (olm) {
        flushPara(); var ol = [];
        while (i < lines.length && (lines[i].match(/^\s*\d+\.\s+/))) { ol.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
        html += "<ol>" + ol.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + "</ol>";
        continue;
      }
      para.push(line); i++;
    }
    flushPara();
    return html;
  }

  // ---- DOM ----
  var $ = function (id) { return document.getElementById(id); };
  var treeEl, contentEl, searchEl;

  // ============================================================
  // 视图切换（底部导航）
  // ============================================================
  function switchView(view) {
    state.view = view;
    // 更新底部导航
    Array.prototype.forEach.call(document.querySelectorAll(".bnav-item"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === view);
    });
    // 显示对应视图
    ["main", "quiz", "favs"].forEach(function (v) {
      var el = $("view-" + v);
      if (el) el.classList.toggle("active", v === view);
    });
    // 顶部 view-tabs 只在 main 视图显示
    var vt = $("viewTabs");
    if (vt) vt.style.display = (view === "main") ? "flex" : "none";
    // 收起搜索栏
    hideSearchbar();
    if (view === "favs") renderFavs();
    if (view === "quiz" && quiz.items.length === 0 && quiz.idx === 0) showQuizStart();
  }

  // ============================================================
  // 搜索栏
  // ============================================================
  function showSearchbar() {
    $("searchbar").hidden = false;
    $("search").focus();
  }
  function hideSearchbar() {
    $("searchbar").hidden = true;
  }

  // ============================================================
  // 主视图：知识/面试 sub-tab
  // ============================================================
  function switchTab(tab) {
    if (tab === state.tab) return;
    state.tab = tab;
    state.key = null;
    state.favOnly = false;
    $("favFilter").classList.remove("active");
    $("favFilter").textContent = "★ 只看收藏";
    Array.prototype.forEach.call(document.querySelectorAll(".vtab"), function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === tab);
    });
    renderTree();
    renderPager();
    contentEl.innerHTML = '<div class="welcome"><div class="welcome-card">' +
      '<h2>' + (tab === "knowledge" ? "📚 知识复习" : "🎯 刷面试题") + "</h2>" +
      "<p>" + (tab === "knowledge" ? "按 12 个学习模块系统掌握大模型 / Agent 知识。" : "先自测、再揭答案。支持精简/详细两种答案模式。") + "</p>" +
      '<p class="welcome-tip">从左侧选择模块和知识点开始。</p></div></div>';
    saveJSON(LS_STATE, { tab: state.tab, key: null, view: state.view });
  }

  // ============================================================
  // 树渲染
  // ============================================================
  function leafMatches(item, q) {
    if (!q) return true;
    var hay = (item.title + " " + (item.tags || []).join(" ") + " " + (item.q || "") + " " + (item.body || "") + " " + (item.a || "") + " " + (item.full || "")).toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function visibleList() {
    var q = (searchEl.value || "").trim().toLowerCase();
    var list = [];
    DATA.forEach(function (mod, mi) {
      itemsOf(mod).forEach(function (it) {
        if (state.favOnly && !isFav(it.id)) return;
        if (!leafMatches(it, q)) return;
        list.push({ mi: mi, id: it.id, item: it });
      });
    });
    return list;
  }

  function renderTree() {
    var q = (searchEl.value || "").trim().toLowerCase();
    treeEl.innerHTML = "";
    var total = 0;
    DATA.forEach(function (mod, mi) {
      var items = itemsOf(mod);
      var visible = items.filter(function (it) {
        if (state.favOnly && !isFav(it.id)) return false;
        return leafMatches(it, q);
      });
      if (visible.length === 0) return;
      total += visible.length;

      var modEl = document.createElement("div");
      modEl.className = "module open";
      var head = document.createElement("button");
      head.className = "m-head";
      head.innerHTML = '<span class="m-no">' + mod.no + '</span>' +
        '<span class="m-title">' + mod.title + '</span>' +
        '<span class="m-caret">▶</span>';
      head.onclick = function () { modEl.classList.toggle("open"); };
      modEl.appendChild(head);

      var leaves = document.createElement("div");
      leaves.className = "leaves";
      visible.forEach(function (it) {
        var leaf = document.createElement("button");
        leaf.className = "leaf" + (state.key === favKey(state.tab, it.id) ? " active" : "") + (hasNote(it.id) ? " has-note" : "");
        leaf.innerHTML = '<span class="dot"></span>' +
          '<span class="leaf-title">' + it.title + '</span>' +
          '<span class="mini"><span class="note-dot"></span>' +
          '<span class="star' + (isFav(it.id) ? " on" : "") + '">★</span></span>';
        leaf.onclick = function () { selectItem(mi, it.id); };
        leaves.appendChild(leaf);
      });
      modEl.appendChild(leaves);
      treeEl.appendChild(modEl);
    });
    $("countHint").textContent = total ? "共 " + total + " 条" : "无匹配";
    if (total === 0) {
      var empty = document.createElement("div");
      empty.style.cssText = "padding:24px;color:#9aa1b1;text-align:center;font-size:13px";
      empty.textContent = state.favOnly ? "暂无收藏内容" : "没有匹配的结果";
      treeEl.appendChild(empty);
    }
  }

  // ============================================================
  // 内容渲染（知识点 / 面试题）
  // ============================================================
  function selectItem(mi, id) {
    var mod = DATA[mi];
    var item = itemsOf(mod).filter(function (x) { return x.id === id; })[0];
    if (!item) return;
    state.key = favKey(state.tab, id);
    state.showAns = false;
    saveJSON(LS_STATE, { tab: state.tab, key: state.key, view: state.view });
    renderTree();
    renderContent(mod, item);
    renderPager();
    if (window.innerWidth < 900) closeSidebar();
    contentEl.scrollTop = 0;
  }

  function getAnswer(item) {
    if (state.ansMode === "full" && item.full) return item.full;
    return item.a || item.full || "";
  }

  function renderContent(mod, item) {
    var isInt = state.tab === "interview";
    var favOn = isFav(item.id);
    var crumb = '<div class="crumb"><b>' + mod.no + " " + mod.title + "</b> · " + (isInt ? "面试题" : "知识点") + "</div>";
    var chips = "";
    if (item.tags) chips = item.tags.map(function (t) { return '<span class="chip">' + t + "</span>"; }).join("");
    chips += '<span class="chip week">' + mod.weeks + "</span>";
    chips += '<span class="chip imp">' + mod.importance + "</span>";

    var head = '<div class="detail-head">' + crumb +
      '<div class="detail-title"><h1>' + item.title + "</h1>" +
      '<div class="head-btns">' +
      '<button class="round-btn fav' + (favOn ? " on" : "") + '" id="favBtn">★</button>' +
      '<button class="round-btn" id="noteBtn">📝</button>' +
      "</div></div>" +
      '<div class="detail-meta">' + chips + "</div></div>";

    var body = '<div class="detail-body">';
    if (isInt) {
      body += '<div class="q-box">❓ ' + escapeHtml(item.q || item.title) + "</div>";
      // 精简/详细切换 tabs（用 data-mode，不用 ID）
      var modeTabs = '<div class="ans-mode-tabs">' +
        '<button class="ans-mode-btn' + (state.ansMode === "concise" ? " active" : "") + '" data-mode="concise">精简</button>' +
        '<button class="ans-mode-btn' + (state.ansMode === "full" ? " active" : "") + '" data-mode="full">详细</button>' +
        '</div>';
      body += '<div class="ans-toggle-row">' + modeTabs + '<button class="ans-toggle-btn" id="ansBtn">👀 显示答案</button></div>';
      body += '<div class="ans-block md" id="ansBlock" style="display:none">' + renderMD(getAnswer(item)) + "</div>";
      if (item.tips) body += '<div class="tips-box"><div class="t-label">💡 易错点 / 提示</div>' + renderMD(item.tips) + "</div>";
    } else {
      body += '<div class="md">' + renderMD(item.body) + "</div>";
    }
    if (item.sources && item.sources.length) {
      body += '<div class="src-box"><div class="s-label">📎 资料来源</div>' +
        item.sources.map(function (s) { return "<code>" + escapeHtml(s) + "</code>"; }).join("") + "</div>";
    }
    body += "</div>";

    contentEl.innerHTML = '<div class="detail">' + head + body + "</div>";

    $("favBtn").onclick = function () { toggleFav(item.id); };
    $("noteBtn").onclick = function () { openNotes(mod, item); };
    if (isInt) {
      // 答案显示/隐藏
      $("ansBtn").onclick = function () {
        var b = $("ansBlock");
        if (b.style.display === "none") { b.style.display = "block"; this.className = "ans-toggle-btn hide"; this.textContent = "🙈 隐藏答案"; }
        else { b.style.display = "none"; this.className = "ans-toggle-btn"; this.textContent = "👀 显示答案"; }
      };
      // 精简/详细切换：在 bindEvents 中的 contentEl 事件委托统一处理（见 bindAnsModeDelegation）
    }
  }

  // ============================================================
  // 上一篇 / 下一篇
  // ============================================================
  function currentIndex() {
    if (!state.key) return -1;
    var list = visibleList();
    for (var i = 0; i < list.length; i++) {
      if (favKey(state.tab, list[i].id) === state.key) return i;
    }
    return -1;
  }
  function go(delta) {
    var list = visibleList();
    var idx = currentIndex();
    if (idx < 0) return;
    var ni = idx + delta;
    if (ni < 0 || ni >= list.length) return;
    selectItem(list[ni].mi, list[ni].id);
  }
  function renderPager() {
    var pager = $("pager");
    if (!pager) return;
    var list = visibleList();
    var idx = currentIndex();
    if (idx < 0 || list.length === 0) { pager.hidden = true; return; }
    pager.hidden = false;
    $("pgPos").textContent = (idx + 1) + " / " + list.length;
    var prev = $("prevBtn"), next = $("nextBtn");
    prev.disabled = (idx <= 0);
    next.disabled = (idx >= list.length - 1);
  }

  // ============================================================
  // 收藏
  // ============================================================
  function toggleFav(id) {
    var k = favKey(state.tab, id);
    var idx = favs.indexOf(k);
    if (idx >= 0) favs.splice(idx, 1); else favs.push(k);
    saveJSON(LS_FAV, favs);
    renderTree();
    renderPager();
    var btn = $("favBtn");
    if (btn) {
      var on = isFav(id);
      btn.className = "round-btn fav" + (on ? " on" : "");
      btn.textContent = "★";
    }
  }

  // ---- 收藏视图渲染 ----
  function renderFavs() {
    var list = $("favsList");
    if (!list) return;
    list.innerHTML = "";

    // 按类型分组
    var kFavs = [], iFavs = [];
    favs.forEach(function (k) {
      var parts = k.split("::");
      if (parts.length !== 2) return;
      var tab = parts[0], id = parts[1];
      // 找到对应 item
      for (var mi = 0; mi < DATA.length; mi++) {
        var mod = DATA[mi];
        var items = tab === "knowledge" ? mod.knowledge : mod.interview;
        for (var j = 0; j < items.length; j++) {
          if (items[j].id === id) {
            var entry = { mi: mi, mod: mod, item: items[j], tab: tab };
            if (tab === "knowledge") kFavs.push(entry); else iFavs.push(entry);
            return;
          }
        }
      }
    });

    if (kFavs.length === 0 && iFavs.length === 0) {
      list.innerHTML = '<div class="favs-empty"><div class="icon">⭐</div><p>还没有收藏任何内容</p><p style="font-size:13px">在知识点或面试题页面点击 ★ 收藏</p></div>';
      return;
    }

    if (iFavs.length > 0) {
      var t1 = document.createElement("div");
      t1.className = "favs-section-title";
      t1.textContent = "🎯 面试题 (" + iFavs.length + ")";
      list.appendChild(t1);
      iFavs.forEach(function (e) { list.appendChild(makeFavItem(e)); });
    }
    if (kFavs.length > 0) {
      var t2 = document.createElement("div");
      t2.className = "favs-section-title";
      t2.textContent = "📚 知识点 (" + kFavs.length + ")";
      list.appendChild(t2);
      kFavs.forEach(function (e) { list.appendChild(makeFavItem(e)); });
    }
  }

  function makeFavItem(e) {
    var btn = document.createElement("button");
    btn.className = "favs-item";
    var icon = e.tab === "knowledge" ? "📚" : "🎯";
    btn.innerHTML = '<span class="f-icon">' + icon + '</span>' +
      '<span class="f-info"><span class="f-title">' + e.item.title + '</span>' +
      '<span class="f-module">' + e.mod.no + ' ' + e.mod.title + '</span></span>' +
      '<span class="f-star">★</span>';
    btn.onclick = function () {
      // 切换到 main 视图并选中该项
      switchView("main");
      if (state.tab !== e.tab) switchTab(e.tab);
      selectItem(e.mi, e.item.id);
    };
    return btn;
  }

  // ============================================================
  // 随机抽题
  // ============================================================
  function getTotalInterviewCount() {
    return DATA.reduce(function (n, m) { return n + (m.interview ? m.interview.length : 0); }, 0);
  }

  function showQuizStart() {
    $("quizStart").hidden = false;
    $("quizActive").hidden = true;
    $("quizResult").hidden = true;
    $("quizTotalCount").textContent = getTotalInterviewCount();
  }

  function startQuiz() {
    // 收集全部面试题
    var pool = [];
    DATA.forEach(function (mod, mi) {
      (mod.interview || []).forEach(function (it) {
        pool.push({ mi: mi, mod: mod, item: it });
      });
    });
    if (pool.length < 10) {
      // 题不够 10 道就全出
      quiz.items = pool.slice();
    } else {
      // 随机抽 10 道
      var arr = pool.slice();
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      quiz.items = arr.slice(0, 10);
    }
    quiz.idx = 0;
    quiz.correct = 0;
    quiz.wrong = 0;
    quiz.revealed = false;

    $("quizStart").hidden = true;
    $("quizActive").hidden = false;
    $("quizResult").hidden = true;
    renderQuizCard();
  }

  function renderQuizCard() {
    var entry = quiz.items[quiz.idx];
    if (!entry) return;
    quiz.revealed = false;

    $("quizProgress").textContent = (quiz.idx + 1) + " / " + quiz.items.length;
    $("quizScore").textContent = "✓ " + quiz.correct + "  ✗ " + quiz.wrong;
    $("quizQModule").textContent = entry.mod.no + " " + entry.mod.title;
    $("quizQTitle").textContent = entry.item.title;
    $("quizQuestion").textContent = entry.item.q || entry.item.title;

    // 重置答案区域
    $("quizRevealZone").hidden = false;
    $("quizAnswer").hidden = true;
    $("quizActions").hidden = true;
    $("quizAnsBody").innerHTML = "";
    $("quizTips").hidden = true;

    // 重置模式按钮 active 状态
    var modeTabs = $("quizModeTabs");
    if (modeTabs) {
      Array.prototype.forEach.call(modeTabs.querySelectorAll(".ans-mode-btn"), function (b) {
        b.classList.toggle("active", b.getAttribute("data-mode") === state.ansMode);
      });
    }

    // 卡片动画
    var card = $("quizCard");
    card.style.animation = "none";
    card.offsetHeight; // reflow
    card.style.animation = "";
  }

  function revealQuizAnswer() {
    var entry = quiz.items[quiz.idx];
    if (!entry) return;
    quiz.revealed = true;

    $("quizRevealZone").hidden = true;
    var ansEl = $("quizAnswer");
    ansEl.hidden = false;
    $("quizAnsBody").innerHTML = renderMD(getAnswer(entry.item));
    if (entry.item.tips) {
      $("quizTips").textContent = "💡 " + entry.item.tips;
      $("quizTips").hidden = false;
    }
    $("quizActions").hidden = false;
  }

  function quizAnswer(correct) {
    if (correct) quiz.correct++; else quiz.wrong++;
    quiz.idx++;
    if (quiz.idx >= quiz.items.length) {
      showQuizResult();
    } else {
      renderQuizCard();
    }
  }

  function showQuizResult() {
    $("quizActive").hidden = true;
    $("quizResult").hidden = false;

    var score = quiz.correct;
    var total = quiz.items.length;
    $("quizResultScore").textContent = score;

    var icon, title, msg;
    if (score >= 9) { icon = "🏆"; title = "太强了！"; msg = "面试稳了，继续保持！"; }
    else if (score >= 7) { icon = "🎉"; title = "很不错！"; msg = "大部分都掌握了，再查漏补缺一下。"; }
    else if (score >= 5) { icon = "💪"; title = "继续加油！"; msg = "过半了，重点看看错题对应的模块。"; }
    else { icon = "📚"; title = "需要加强！"; msg = "建议先系统复习对应模块的知识点，再来抽题。"; }
    $("quizResultIcon").textContent = icon;
    $("quizResultTitle").textContent = title;
    $("quizResultMsg").textContent = msg;
  }

  // ============================================================
  // 笔记
  // ============================================================
  var notesItem = null;
  function openNotes(mod, item) {
    notesItem = { mod: mod, item: item };
    var k = favKey(state.tab, item.id);
    $("notesCtx").textContent = mod.no + " " + mod.title + "  ›  " + item.title;
    var ta = $("notesArea");
    ta.value = notes[k] || "";
    $("notesSaved").textContent = "";
    $("notesMask").classList.add("show");
    $("notesPanel").classList.add("show");
    setTimeout(function () { ta.focus(); }, 250);
  }
  function closeNotes() {
    $("notesMask").classList.remove("show");
    $("notesPanel").classList.remove("show");
  }
  function saveNotes() {
    if (!notesItem) return;
    var k = favKey(state.tab, notesItem.item.id);
    var v = $("notesArea").value;
    if (v && v.trim()) notes[k] = v; else delete notes[k];
    saveJSON(LS_NOTE, notes);
    $("notesSaved").textContent = "已保存 ✓";
    renderTree();
    renderPager();
    setTimeout(closeNotes, 500);
  }

  // ============================================================
  // 侧栏抽屉
  // ============================================================
  function openSidebar() { $("sidebar").classList.add("show"); $("scrim").classList.add("show"); }
  function closeSidebar() { $("sidebar").classList.remove("show"); $("scrim").classList.remove("show"); }

  // ============================================================
  // 事件绑定
  // ============================================================
  function bindEvents() {
    // 底部导航
    $("bottomNav").addEventListener("click", function (e) {
      var b = e.target.closest(".bnav-item");
      if (b) switchView(b.getAttribute("data-view"));
    });

    // 顶栏搜索
    $("searchToggleBtn").onclick = function () {
      if ($("searchbar").hidden) showSearchbar(); else hideSearchbar();
    };
    $("searchClose").onclick = hideSearchbar;

    // 菜单按钮（移动端）
    $("menuBtn").onclick = function () {
      $("sidebar").classList.contains("show") ? closeSidebar() : openSidebar();
    };
    $("scrim").onclick = closeSidebar;

    // 知识/面试 sub-tab
    $("viewTabs").addEventListener("click", function (e) {
      var t = e.target.closest(".vtab");
      if (t) switchTab(t.getAttribute("data-tab"));
    });

    // 搜索
    searchEl.addEventListener("input", function () { renderTree(); renderPager(); });

    // 只看收藏
    $("favFilter").onclick = function () {
      state.favOnly = !state.favOnly;
      this.classList.toggle("active", state.favOnly);
      this.textContent = state.favOnly ? "★ 已筛选收藏" : "★ 只看收藏";
      renderTree();
      renderPager();
    };

    // 笔记
    $("notesClose").onclick = closeNotes;
    $("notesMask").onclick = closeNotes;
    $("notesSave").onclick = saveNotes;
    $("notesArea").addEventListener("input", function () { $("notesSaved").textContent = ""; });

    // 上/下一篇
    $("prevBtn").onclick = function () { go(-1); };
    $("nextBtn").onclick = function () { go(1); };

    // 键盘
    document.addEventListener("keydown", function (e) {
      var t = e.target;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if (e.key === "ArrowRight") { go(1); }
      else if (e.key === "ArrowLeft") { go(-1); }
    });

    // 触摸滑动（上/下一篇）
    var touchX = null, touchY = null;
    contentEl.addEventListener("touchstart", function (e) {
      if (e.touches.length === 1) { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }
    }, { passive: true });
    contentEl.addEventListener("touchend", function (e) {
      if (touchX === null) return;
      var dx = e.changedTouches[0].clientX - touchX;
      var dy = e.changedTouches[0].clientY - touchY;
      touchX = touchY = null;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) { go(dx < 0 ? 1 : -1); }
    }, { passive: true });

    // ---- 抽题事件 ----
    $("quizStartBtn").onclick = startQuiz;
    $("quizQuitBtn").onclick = showQuizStart;
    $("quizRevealBtn").onclick = revealQuizAnswer;
    $("quizCorrectBtn").onclick = function () { quizAnswer(true); };
    $("quizWrongBtn").onclick = function () { quizAnswer(false); };
    $("quizRetryBtn").onclick = startQuiz;
    $("quizBackBtn").onclick = function () { switchView("main"); };

    // ---- 精简/详细切换（统一事件委托：详情页 + 抽题页共用） ----
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".ans-mode-btn");
      if (!btn) return;
      var mode = btn.getAttribute("data-mode");
      if (!mode || mode === state.ansMode) return;
      state.ansMode = mode;
      try { localStorage.setItem(LS_ANSMODE, mode); } catch (err) {}

      // 更新全局所有 ans-mode-btn 按钮样式
      Array.prototype.forEach.call(document.querySelectorAll(".ans-mode-btn"), function (b) {
        b.classList.toggle("active", b.getAttribute("data-mode") === mode);
      });

      // 更新详情页答案（如果正在显示）
      var blk = $("ansBlock");
      if (blk && blk.style.display !== "none" && state.key) {
        // 找到当前选中 item
        var id = state.key.split("::")[1];
        for (var mi = 0; mi < DATA.length; mi++) {
          var hit = itemsOf(DATA[mi]).filter(function (x) { return x.id === id; })[0];
          if (hit) { blk.innerHTML = renderMD(getAnswer(hit)); break; }
        }
      }

      // 更新抽题答案（如果正在显示）
      var quizAns = $("quizAnsBody");
      var quizAnsEl = $("quizAnswer");
      if (quizAns && quizAnsEl && !quizAnsEl.hidden && quiz.items[quiz.idx]) {
        quizAns.innerHTML = renderMD(getAnswer(quiz.items[quiz.idx].item));
      }
    });
  }

  // ============================================================
  // 初始化
  // ============================================================
  function init() {
    treeEl = $("tree");
    contentEl = $("content");
    searchEl = $("search");

    bindEvents();
    renderTree();

    // 恢复上次浏览的位置（记忆功能）
    var saved = loadJSON(LS_STATE, null);
    if (saved) {
      // 1) 恢复底部视图：收藏 / 抽题 / 主页
      if (saved.view === "favs") {
        switchView("favs");
      } else if (saved.view === "quiz") {
        switchView("quiz");
      } else {
        // 2) 主页内：恢复 知识/面试 子页
        if (saved.tab && saved.tab !== state.tab) {
          state.tab = saved.tab;
          Array.prototype.forEach.call(document.querySelectorAll(".vtab"), function (t) {
            t.classList.toggle("active", t.getAttribute("data-tab") === saved.tab);
          });
          renderTree();
        }
        // 3) 恢复具体条目（走 selectItem，保证侧栏高亮 + 翻页位置都正确）
        if (saved.key) {
          var id = saved.key.split("::")[1];
          for (var mi = 0; mi < DATA.length; mi++) {
            var hit = itemsOf(DATA[mi]).filter(function (x) { return x.id === id; })[0];
            if (hit) {
              state.key = saved.key;
              selectItem(mi, id);
              break;
            }
          }
        }
      }
    }
    $("quizTotalCount").textContent = getTotalInterviewCount();
  }

  init();
})();
