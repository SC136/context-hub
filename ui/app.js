"use strict";

(function () {
  var invoke = window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core.invoke : null;
  var $ = function (id) { return document.getElementById(id); };

  var NO_PROJECT = "(no project folder)";
  var DAYS = 60;
  var DAY_MS = 86400000;
  var MAX_TURNS = 150;
  var MAX_CHARS = 2600;

  var state = {
    agents: [],
    sessions: [],
    view: "timeline",
    status: "loading", // loading | ready | error
    error: null,
    agent: null,
    project: null,
    folder: null,
    q: "",
    open: null,
    busy: false,
    scannedAt: null,
    ctxText: "",
    layout: "list"
  };

  try { if (localStorage.getItem("layout") === "grid") state.layout = "grid"; } catch (e) { /* storage can be blocked */ }

  /* ---------- small helpers ------------------------------------------ */

  function reduceMotion() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function bytes(n) {
    if (!n) return "0 B";
    var u = ["B", "KB", "MB", "GB"];
    var i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i];
  }

  function dayKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function startOfDay(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

  function timeOf(ms) { var d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  function dayLabel(key) {
    var now = new Date();
    var todayK = dayKey(now.getTime());
    now.setDate(now.getDate() - 1);
    var yesterdayK = dayKey(now.getTime());
    if (key === todayK) return "Today";
    if (key === yesterdayK) return "Yesterday";
    var p = key.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, sameYear
      ? { weekday: "short", month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function age(ms) {
    if (!ms) return "";
    var diff = Date.now() - ms;
    if (diff < 6e4) return "now";
    if (diff < 36e5) return Math.round(diff / 6e4) + "m";
    if (diff < DAY_MS) return Math.round(diff / 36e5) + "h";
    if (diff < 14 * DAY_MS) return Math.round(diff / DAY_MS) + "d";
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function shortProject(path) {
    if (!path || path === NO_PROJECT) return NO_PROJECT;
    var parts = path.split(/[\\/]+/).filter(Boolean);
    var last2 = parts.slice(-2);
    // scratch workspaces sit under a bare UUID folder: that says nothing, so skip it
    if (last2.length === 2 && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(last2[0])) return last2[1];
    return parts.length > 1 ? last2.join(" / ") : path;
  }

  function hl(text, q) {
    var s = String(text == null ? "" : text);
    if (!q) return esc(s);
    // match on the original string: lowercasing can change its length (e.g. a dotted capital I)
    var re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    var out = "";
    var i = 0;
    var m;
    while ((m = re.exec(s)) !== null) {
      if (!m[0].length) { re.lastIndex++; continue; }
      out += esc(s.slice(i, m.index)) + "<mark>" + esc(m[0]) + "</mark>";
      i = m.index + m[0].length;
    }
    return out + esc(s.slice(i));
  }

  function errText(err) { return String(err && err.message ? err.message : err); }

  function sentence(s) { s = String(s).trim(); return /[.!?]$/.test(s) ? s : s + "."; }

  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1900);
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  /* ---------- theme --------------------------------------------------- */

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("theme", t); } catch (e) { /* storage can be blocked */ }
    $("themeIcon").setAttribute("href", t === "light" ? "#i-moon" : "#i-sun");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "light" ? "#f6f7f8" : "#0f1113");
  }

  var savedTheme = null;
  try { savedTheme = localStorage.getItem("theme"); } catch (e) { savedTheme = null; }
  setTheme(savedTheme === "light" ? "light" : "dark");

  $("themeBtn").addEventListener("click", function () {
    var next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    if (!document.startViewTransition || reduceMotion()) { setTheme(next); return; }
    var r = $("themeBtn").getBoundingClientRect();
    document.documentElement.style.setProperty("--vx", (r.left + r.width / 2) + "px");
    document.documentElement.style.setProperty("--vy", (r.top + r.height / 2) + "px");
    document.startViewTransition(function () { setTheme(next); });
  });

  /* ---------- derived data -------------------------------------------- */

  function matches(f, q) {
    if (state.agent && f.source !== state.agent) return false;
    if (!q) return true;
    var hay = (f.name + " " + (f.summary || "") + " " + f.path + " " + (f.project || "")).toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function visible() {
    var q = state.q.trim().toLowerCase();
    return state.sessions.filter(function (f) {
      if (state.project && (f.project || NO_PROJECT) !== state.project) return false;
      return matches(f, q);
    });
  }

  /* ---------- rendering ----------------------------------------------- */

  function renderRail() {
    var total = state.agents.reduce(function (s, a) { return s + a.count; }, 0);
    $("agentTotal").textContent = total ? total.toLocaleString() : "";
    $("agents").innerHTML = state.agents.map(function (a) {
      return '<button class="ag' + (a.count ? "" : " zero") + '" type="button" data-agent="' + esc(a.agent) +
        '" aria-pressed="' + (state.agent === a.agent) + '">' +
        '<span class="nm">' + esc(a.agent) + '</span><span class="lead"></span>' +
        '<span class="n">' + a.count.toLocaleString() + "</span></button>";
    }).join("");
    $("scanned").textContent = state.scannedAt ? "Scanned " + timeOf(state.scannedAt) : "Not scanned yet";
  }

  function renderFilters() {
    var pills = [];
    if (state.agent) pills.push(["agent", state.agent, state.agent]);
    if (state.project && state.view !== "projects") pills.push(["project", shortProject(state.project), state.project]);
    if (state.folder) pills.push(["folder", state.folder, state.folder]);
    var box = $("filters");
    box.hidden = !pills.length;
    box.innerHTML = pills.map(function (p) {
      return '<span class="pill" title="' + esc(p[2]) + '"><span>' + esc(p[1]) + "</span>" +
        '<button type="button" data-clear="' + p[0] + '" aria-label="Remove filter: ' + esc(p[1]) + '">' +
        '<svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button></span>';
    }).join("");
  }

  function emptyBlock() {
    return '<div class="empty"><h2>Nothing matches</h2><p>No sessions fit the current search and filters.</p>' +
      '<button class="btn" type="button" data-act="clear">Clear search and filters</button></div>';
  }

  function rowHtml(f, q) {
    var cur = state.open && state.open.id === f.id;
    return '<button class="row" type="button" data-id="' + esc(f.id) + '"' + (cur ? ' aria-current="true"' : "") + ">" +
      '<span class="t">' + timeOf(f.modified) + "</span>" +
      '<span class="m"><span class="n">' + hl(f.name, q) + '</span><span class="s"><span class="who">' + esc(f.source) + "</span>" +
      hl(f.summary || f.project || "", q) + "</span></span>" +
      '<span class="z">' + bytes(f.size) + "</span></button>";
  }

  var ribbonSeen = false;

  function renderRibbon(rows) {
    var today = startOfDay(Date.now());
    var counts = {};
    rows.forEach(function (f) { var k = dayKey(f.modified); counts[k] = (counts[k] || 0) + 1; });
    var days = [];
    var max = 1;
    for (var i = DAYS - 1; i >= 0; i--) {
      var t = new Date(today);
      t.setDate(t.getDate() - i);
      var key = dayKey(t.getTime());
      var n = counts[key] || 0;
      if (n > max) max = n;
      days.push({ key: key, n: n });
    }
    function h(d) { return d.n ? Math.max(0.08, d.n / max) : 0.055; }

    var el = $("ribbon");
    var first = !ribbonSeen && !reduceMotion();
    ribbonSeen = true;
    el.innerHTML = days.map(function (d, i) {
      return '<button class="tick' + (d.n ? "" : " zero") + '" type="button" tabindex="-1" data-day="' + d.key +
        '" data-n="' + d.n + '" style="--i:' + i + ";--h:" + (first ? 0 : h(d).toFixed(3)) + '"><i></i></button>';
    }).join("");

    if (first) {
      el.classList.add("intro");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var ticks = el.querySelectorAll(".tick");
          for (var k = 0; k < ticks.length; k++) ticks[k].style.setProperty("--h", h(days[k]).toFixed(3));
        });
      });
      setTimeout(function () { el.classList.remove("intro"); }, 1400);
    }
  }

  function renderTimeline() {
    var rows = visible();
    var total = state.sessions.length;
    $("count").textContent = rows.length === total
      ? total.toLocaleString() + " sessions"
      : rows.length.toLocaleString() + " of " + total.toLocaleString() + " sessions";
    renderRibbon(rows);

    var box = $("days");
    if (!rows.length) { box.innerHTML = emptyBlock(); return; }

    var q = state.q.trim();
    var groups = [];
    var cur = null;
    rows.forEach(function (f) {
      var k = dayKey(f.modified);
      if (!cur || cur.key !== k) { cur = { key: k, rows: [] }; groups.push(cur); }
      cur.rows.push(f);
    });
    box.innerHTML = groups.map(function (g) {
      return '<section class="grp" data-day="' + g.key + '"><div class="day"><h2>' + esc(dayLabel(g.key)) + "</h2><span>" +
        g.rows.length + (g.rows.length === 1 ? " session" : " sessions") + "</span></div>" +
        g.rows.map(function (f) { return rowHtml(f, q); }).join("") + "</section>";
    }).join("");
  }

  function renderProjects() {
    var q = state.q.trim().toLowerCase();
    var map = {};
    var order = [];
    state.sessions.forEach(function (f) {
      if (!matches(f, q)) return;
      var k = f.project || NO_PROJECT;
      var g = map[k];
      if (!g) { g = map[k] = { path: k, n: 0, agents: {}, newest: 0 }; order.push(g); }
      g.n++;
      g.agents[f.source] = true;
      g.newest = Math.max(g.newest, f.modified || 0);
    });
    order.sort(function (a, b) { return b.newest - a.newest; });
    $("count").textContent = order.length.toLocaleString() + (order.length === 1 ? " project" : " projects");

    var raw = state.q.trim();
    var grid = state.layout === "grid";
    $("projects").className = grid ? "pgrid" : "";
    if (grid && order.length) {
      $("projects").innerHTML = order.map(function (g) {
        var n = Object.keys(g.agents).length;
        return '<button class="pcard" type="button" data-project="' + esc(g.path) + '">' +
          '<span class="pn">' + hl(shortProject(g.path), raw) + '</span>' +
          '<span class="pp">' + hl(g.path, raw) + '</span>' +
          '<span class="pf"><span class="pc">' + g.n + (g.n === 1 ? " session" : " sessions") + '</span>' +
          '<span class="pw">' + n + (n === 1 ? " assistant" : " assistants") + " &middot; " + age(g.newest) + '</span></span></button>';
      }).join("");
      return;
    }
    var head = '<div class="phead"><span>Project</span><span class="pa">Assistants</span><span class="r">Sessions</span><span class="r">Active</span></div>';
    $("projects").innerHTML = order.length ? head + order.map(function (g) {
      var names = Object.keys(g.agents);
      return '<button class="prow" type="button" data-project="' + esc(g.path) + '">' +
        '<span class="ptext"><span class="pn">' + hl(shortProject(g.path), raw) + '</span><span class="pp">' + hl(g.path, raw) + "</span></span>" +
        '<span class="pa" title="' + esc(names.join(", ")) + '">' + names.length + (names.length === 1 ? " assistant" : " assistants") + "</span>" +
        '<span class="pc">' + g.n + '</span><span class="pw">' + age(g.newest) + "</span></button>";
    }).join("") : emptyBlock();
  }

  function renderSkeleton() {
    var sk = new Array(9 + 1).join('<div class="sk"></div>');
    $("days").innerHTML = sk;
    $("projects").innerHTML = sk;
    $("ribbon").innerHTML = "";
    $("count").textContent = "";
  }

  /* ---------- project summary + context ---------------------------------- */

  var projCache = { key: null, token: 0, ctx: "" };

  function readable(f) {
    return !/\.(pb|db|vscdb|sqlite)$/i.test(f.path) && f.size > 0;
  }

  // Large transcripts: only the tail holds the latest turns.
  function readRecent(f) {
    var cmd = f.size <= 1048576 ? "read_file" : "read_tail";
    var args = cmd === "read_file" ? { filePath: f.path } : { filePath: f.path, maxBytes: 768 * 1024 };
    return invoke(cmd, args);
  }

  function lastTurn(turns, role) {
    for (var i = turns.length - 1; i >= 0; i--) if (turns[i].role === role) return turns[i].text;
    return "";
  }

  function clip(s, n) {
    s = String(s).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  function renderProject() {
    var box = $("proj");
    var show = state.view === "timeline" && !!state.project && state.status === "ready";
    box.hidden = !show;
    if (!show) return;
    var key = state.project + "|" + state.scannedAt;
    if (projCache.key === key) return;
    projCache.key = key;
    projCache.ctx = "";
    var token = ++projCache.token;
    $("projLast").innerHTML = '<p class="quiet">Reading recent sessions…</p>';
    $("projMeta").textContent = "";
    $("projCopy").disabled = true;
    loadProject(state.project, token);
  }

  async function loadProject(path, token) {
    var all = state.sessions.filter(function (f) { return (f.project || NO_PROJECT) === path; });
    var parts = [];
    if (invoke) {
      var reads = await Promise.all(all.filter(readable).slice(0, 6).map(function (f) {
        return readRecent(f).then(
          function (r) { return { f: f, content: (r && r.content) || "" }; },
          function () { return null; }
        );
      }));
      parts = reads.filter(Boolean)
        .map(function (x) { return { f: x.f, turns: extractTurns(x.content) }; })
        .filter(function (x) { return x.turns.length; });
    }
    if (token !== projCache.token) return;

    if (!parts.length) {
      $("projLast").innerHTML = '<p class="quiet">None of this project\'s ' + all.length +
        (all.length === 1 ? " session is" : " sessions are") + " in a format that can be read here yet.</p>";
      return;
    }

    var top = parts[0];
    var u = lastTurn(top.turns, "user");
    var a = lastTurn(top.turns, "assistant");
    $("projMeta").textContent = top.f.source + ", " + new Date(top.f.modified).toLocaleString();
    $("projLast").innerHTML =
      (u ? '<p><b>You</b>' + esc(clip(u, 240)) + "</p>" : "") +
      (a ? "<p><b>" + esc(top.f.source) + "</b>" + esc(clip(a, 240)) + "</p>" : "");

    var names = {};
    all.forEach(function (f) { names[f.source] = true; });
    var LIMIT = 60000;
    var out = "Project: " + path + "\n" +
      "Sessions: " + all.length + " across " + Object.keys(names).join(", ") + "\n" +
      "Most recent activity: " + new Date(all[0].modified).toLocaleString() + " (" + top.f.source + ")\n\n" +
      "Where it left off\n" +
      (u ? "User asked: " + clip(u, 600) + "\n" : "") +
      (a ? top.f.source + " replied: " + clip(a, 900) + "\n" : "") +
      "\nRecent sessions, newest first. Continue this project from where it left off.\n\n";
    var trimmed = false;
    parts.slice(0, 5).forEach(function (p) {
      if (trimmed) return;
      var block = "### " + p.f.source + ", " + new Date(p.f.modified).toLocaleString() + "\n";
      p.turns.slice(-8).forEach(function (t) {
        block += (t.role === "user" ? "User" : "Assistant") + ":\n" + clip(t.text, 1500) + "\n\n";
      });
      if (out.length + block.length > LIMIT) {
        var room = LIMIT - out.length - 60;
        if (room > 200) out += block.slice(0, room) + "\n";
        out += "[Trimmed: older sessions are not included.]\n";
        trimmed = true;
      } else {
        out += block;
      }
    });
    projCache.ctx = out;
    $("projCopy").disabled = false;
  }

  // re-rendering replaces the buttons, so put keyboard focus back on the one that had it
  function render() {
    var ae = document.activeElement;
    var sel = ae && ae.dataset && ae.dataset.agent ? '.ag[data-agent="' + CSS.escape(ae.dataset.agent) + '"]' : null;
    draw();
    renderProject();
    if (sel) { var again = document.querySelector(sel); if (again) again.focus(); }
  }

  function draw() {
    renderRail();
    renderFilters();
    var err = state.status === "error";
    $("state").hidden = !err;
    $("viewTimeline").hidden = err || state.view !== "timeline";
    $("viewProjects").hidden = err || state.view !== "projects";
    var btns = document.querySelectorAll(".view-btn");
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute("aria-current", String(btns[i].dataset.view === state.view));
    $("title").textContent = state.view === "projects" ? "Projects" : "Timeline";
    $("layoutSeg").hidden = err || state.view !== "projects";
    var lb = $("layoutSeg").querySelectorAll("button");
    for (var j = 0; j < lb.length; j++) lb[j].setAttribute("aria-pressed", String(lb[j].dataset.layout === state.layout));

    if (err) {
      $("count").textContent = "";
      $("stateTitle").textContent = state.error ? state.error.title : "";
      $("stateText").textContent = state.error ? state.error.text : "";
      return;
    }
    if (state.status === "loading") { renderSkeleton(); return; }
    if (state.view === "projects") renderProjects(); else renderTimeline();
  }

  function fail(title, text) {
    state.status = "error";
    state.error = { title: title, text: text };
    render();
  }

  /* ---------- scanning ------------------------------------------------- */

  function setBusy(b) {
    $("scanBtn").disabled = b;
    $("scanLabel").textContent = b ? "Scanning…" : "Scan again";
  }

  async function scan() {
    if (!invoke) {
      fail("Desktop backend not reachable", "Open this page from the Context Hub window so it can read your disk.");
      return;
    }
    if (state.busy) return;
    state.busy = true;
    setBusy(true);
    state.folder = null;
    if (!state.sessions.length || state.status !== "ready") { state.status = "loading"; render(); }

    try {
      var agents = await invoke("scan_directories");
      state.agents = (agents || []).filter(function (a) { return a.exists; })
        .sort(function (a, b) { return b.count - a.count; });
      state.scannedAt = Date.now();
      renderRail();

      var all = (await invoke("all_sessions")) || [];
      var have = {};
      all.forEach(function (f) { have[f.source] = true; });
      for (var i = 0; i < state.agents.length; i++) {
        var a = state.agents[i];
        if (a.count > 0 && !have[a.agent]) {
          try { all = all.concat((await invoke("list_files", { directory: a.path })) || []); } catch (e) { /* skip this source */ }
        }
      }
      all.sort(function (x, y) { return (y.modified || 0) - (x.modified || 0); });
      state.sessions = all;
      state.status = "ready";
      if (!all.length) {
        fail("No sessions found", "None of the folders your assistants write to hold readable transcripts yet. Scan again after using an assistant, or open a folder below.");
      } else {
        render();
      }
    } catch (err) {
      fail("Couldn't read your sessions", sentence(errText(err)) + " Scan again, or open a folder below.");
    } finally {
      state.busy = false;
      setBusy(false);
    }
  }

  $("scanBtn").addEventListener("click", scan);
  $("stateRetry").addEventListener("click", scan);

  $("folderForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var p = $("folderPath").value.trim();
    if (!p) { $("folderPath").focus(); return; }
    if (!invoke) return;
    if (state.busy) { toast("A scan is running. Try again when it finishes."); return; }
    state.busy = true;
    setBusy(true);
    try {
      var rows = (await invoke("list_files", { directory: p })) || [];
      if (!rows.length) { fail("No sessions in that folder", "Nothing readable was found in " + p + ". Check the path and try again."); return; }
      rows.sort(function (x, y) { return (y.modified || 0) - (x.modified || 0); });
      state.sessions = rows;
      state.folder = p;
      state.agent = null;
      state.project = null;
      state.status = "ready";
      render();
    } catch (err) {
      fail("Couldn't read that folder", sentence(errText(err)) + " Check the path and try again.");
    } finally {
      state.busy = false;
      setBusy(false);
    }
  });

  /* ---------- transcript parsing --------------------------------------- */

  var WRAPPED = /<(system-reminder|environment_context|user_instructions|timestamp|local-command-caveat|command-name|command-message|command-args)>[\s\S]*?<\/\1>/gi;

  function clean(t) {
    return String(t).replace(WRAPPED, "").replace(/<\/?user_query>/gi, "").trim();
  }

  function flat(c) {
    if (typeof c === "string") return c;
    if (!Array.isArray(c)) return "";
    return c.filter(function (x) {
      return x && typeof x.text === "string" &&
        (x.type === "text" || x.type === "input_text" || x.type === "output_text" || x.type == null);
    }).map(function (x) { return x.text; }).join("\n\n");
  }

  function collect(o, push) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o.history)) {
      o.history.forEach(function (h) {
        var m = (h && h.message) || h;
        if (m) push(m.role, flat(m.content));
      });
      return;
    }
    // VS Code / Copilot chat files: requests[] with message.text and response[] parts
    if (Array.isArray(o.requests)) {
      o.requests.forEach(function (r) {
        if (!r) return;
        if (r.message && typeof r.message.text === "string") push("user", r.message.text);
        var parts = Array.isArray(r.response) ? r.response : [];
        var reply = parts.map(function (p) {
          if (!p) return "";
          if (typeof p.value === "string") return p.value;
          if (p.content && typeof p.content.value === "string") return p.content.value;
          return "";
        }).join("");
        if (reply) push("assistant", reply);
      });
      return;
    }
    if ((o.type === "user" || o.type === "assistant") && o.message && !o.isMeta) {
      push(o.message.role || o.type, flat(o.message.content));
      return;
    }
    if (o.type === "response_item" && o.payload && o.payload.type === "message") {
      push(o.payload.role, flat(o.payload.content));
      return;
    }
    if (o.role === "user" || o.role === "assistant") {
      var c = o.message && o.message.content !== undefined ? o.message.content : o.content;
      push(o.role, flat(c));
    }
  }

  // index of the brace that closes the one at `start`, skipping braces inside strings; -1 if cut off
  function closeBrace(text, start) {
    var depth = 0, inStr = false;
    for (var j = start; j < text.length; j++) {
      var c = text[j];
      if (inStr) {
        if (c === "\\") j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return j; }
    }
    return -1;
  }

  function recoverRequests(text) {
    var out = [], starts = /\{\s*"requestId"/g, m;
    while ((m = starts.exec(text))) {
      var end = closeBrace(text, m.index);
      if (end < 0) break;
      try { out.push(JSON.parse(text.slice(m.index, end + 1))); } catch (e) { /* skip damaged object */ }
      starts.lastIndex = end + 1;
    }
    return out;
  }

  function extractTurns(content) {
    var turns = [];
    function push(role, text) {
      if (role !== "user" && role !== "assistant") return;
      var t = clean(text);
      if (t) turns.push({ role: role, text: t });
    }
    var trimmed = content.trim();
    if (!trimmed) return turns;

    var whole = null;
    if (trimmed[0] === "{" || trimmed[0] === "[") {
      try { whole = JSON.parse(trimmed); } catch (e) { whole = null; }
    }
    if (whole) {
      if (Array.isArray(whole)) whole.forEach(function (o) { collect(o, push); }); else collect(whole, push);
      return turns;
    }
    // A cut-off VS Code chat file (tail of a large file): rescue each complete request object
    if (/"requestId"/.test(trimmed)) {
      var reqs = recoverRequests(trimmed);
      if (reqs.length) { collect({ requests: reqs }, push); return turns; }
    }
    trimmed.split("\n").forEach(function (line) {
      var s = line.trim();
      if (s[0] !== "{") return;
      try { collect(JSON.parse(s), push); } catch (e) { /* partial or non-JSON line */ }
    });
    return turns;
  }

  function contextText(f, turns) {
    var out = "Earlier session from " + f.source + (f.project ? " in " + f.project : "") + ", " +
      new Date(f.modified).toLocaleString() + ". Continue from where it left off.\n\n";
    var LIMIT = 60000;
    for (var i = 0; i < turns.length; i++) {
      var line = (turns[i].role === "user" ? "User" : "Assistant") + ":\n" + turns[i].text + "\n\n";
      if (out.length + line.length > LIMIT) {
        // keep what fits of the turn that crossed the limit instead of dropping it whole
        var room = LIMIT - out.length - 80;
        if (room > 200) out += line.slice(0, room) + "\n";
        out += "[Trimmed: the rest of this session is not included.]\n";
        break;
      }
      out += line;
    }
    return out;
  }

  /* ---------- inspector ------------------------------------------------- */

  var openToken = 0;
  var lastRow = null;

  function note(title, text) {
    return '<div class="note"><h3>' + esc(title) + "</h3><p>" + esc(text) + "</p></div>";
  }

  function markCurrent() {
    var rows = document.querySelectorAll("#days .row");
    for (var i = 0; i < rows.length; i++) {
      if (state.open && rows[i].dataset.id === state.open.id) rows[i].setAttribute("aria-current", "true");
      else rows[i].removeAttribute("aria-current");
    }
  }

  async function openSession(f, fromEl) {
    state.open = f;
    state.ctxText = "";
    if (fromEl) lastRow = fromEl;
    markCurrent();

    $("insp").hidden = false;
    $("iTitle").tabIndex = -1;
    $("iTitle").textContent = f.name;
    $("iTitle").focus({ preventScroll: true });
    $("iPath").innerHTML = esc(f.path).replace(/([\\\/])/g, "$1<wbr>");
    var meta = [
      ["Assistant", f.source],
      ["Project", f.project ? shortProject(f.project) : "None"],
      ["Modified", new Date(f.modified).toLocaleString()],
      ["Size", bytes(f.size)]
    ];
    $("iMeta").innerHTML = meta.map(function (m) {
      return '<div><dt>' + m[0] + '</dt><dd title="' + esc(m[1]) + '">' + esc(m[1]) + "</dd></div>";
    }).join("");
    var body = $("iBody");
    $("iScroll").scrollTop = 0;
    body.innerHTML = '<p class="turns-note">Loading transcript&hellip;</p>';
    $("iCopyCtx").disabled = true;

    var token = ++openToken;
    if (!invoke) { body.innerHTML = note("Preview unavailable", "Open this page from the Context Hub window to read session files."); return; }

    var res;
    try {
      res = await invoke("read_file", { filePath: f.path });
    } catch (err) {
      if (token !== openToken) return;
      body.innerHTML = note("Couldn't open this session", errText(err));
      return;
    }
    if (token !== openToken) return;

    var content = (res && res.content) || "";
    if (/^This file is [\d.]+ MB, too large to preview/.test(content)) {
      body.innerHTML = note("Too large to preview here", "This session is " + bytes(f.size) + ", which is more than the preview can open. Copy the path to read it in your editor.");
      return;
    }
    if (/^Binary file/.test(content)) {
      body.innerHTML = note("No text preview", "This file isn't plain text, so there is nothing to show. Copy the path to open it elsewhere.");
      return;
    }

    var turns = extractTurns(content);
    if (turns.length) {
      var shown = turns.slice(0, MAX_TURNS);
      body.innerHTML = '<p class="turns-note">' + turns.length + (turns.length === 1 ? " message" : " messages") +
        (turns.length > MAX_TURNS ? ", showing the first " + MAX_TURNS : "") + "</p>" +
        shown.map(function (t) {
          var txt = t.text.length > MAX_CHARS ? t.text.slice(0, MAX_CHARS) + "…" : t.text;
          return '<div class="turn" data-role="' + t.role + '"><p class="who-l">' +
            (t.role === "user" ? "You" : esc(f.source)) + '</p><div class="said">' + esc(txt) + "</div></div>";
        }).join("");
      state.ctxText = contextText(f, turns);
    } else if (content.trim()) {
      body.innerHTML = '<pre class="raw">' + esc(content.slice(0, 20000)) + (content.length > 20000 ? "\n\n…" : "") + "</pre>";
      state.ctxText = content.slice(0, 60000);
    } else {
      body.innerHTML = note("Empty session", "This file has no content yet.");
    }
    $("iCopyCtx").disabled = !state.ctxText;
  }

  function closeInspector() {
    var id = state.open && state.open.id;
    openToken++;
    state.open = null;
    $("insp").hidden = true;
    markCurrent();
    // the list may have re-rendered since the row was clicked, so find it again by id
    var back = id ? document.querySelector('#days .row[data-id="' + CSS.escape(id) + '"]') : null;
    if (!back && lastRow && document.body.contains(lastRow)) back = lastRow;
    (back || $("search")).focus();
    lastRow = null;
  }

  $("iClose").addEventListener("click", closeInspector);

  $("iCopyPath").addEventListener("click", function () {
    if (!state.open) return;
    copyText(state.open.path).then(function (ok) { toast(ok ? "Path copied" : "Couldn't copy: the clipboard is blocked"); });
  });

  $("projCopy").addEventListener("click", function () {
    if (!projCache.ctx) return;
    copyText(projCache.ctx).then(function (ok) {
      toast(ok ? "Copied. Paste it into an assistant to pick this project back up." : "Couldn't copy: the clipboard is blocked");
    });
  });

  $("iCopyCtx").addEventListener("click", function () {
    if (!state.ctxText) return;
    copyText(state.ctxText).then(function (ok) {
      toast(ok ? "Copied. Paste it into another assistant to continue." : "Couldn't copy: the clipboard is blocked");
    });
  });

  /* ---------- interaction ------------------------------------------------ */

  function clearAll() {
    clearTimeout(searchTimer);
    state.q = "";
    state.agent = null;
    state.project = null;
    $("search").value = "";
    render();
  }

  var narrow = matchMedia("(max-width: 1000px)");

  // below 1000px the rail is an overlay: closed it must not be tabbable, open it owns the keyboard
  function syncInert() {
    var open = document.body.dataset.rail === "open";
    $("rail").inert = narrow.matches && !open;
    $("main").inert = narrow.matches && open;
  }

  function setRail(open) {
    if (open) document.body.dataset.rail = "open"; else delete document.body.dataset.rail;
    $("scrim").hidden = !open;
    $("railToggle").setAttribute("aria-expanded", String(open));
    syncInert();
    if (open) { var first = document.querySelector(".view-btn"); if (first) first.focus(); }
    else if (narrow.matches) $("railToggle").focus();
  }

  function closeRail() { setRail(false); }

  narrow.addEventListener("change", function () {
    if (!narrow.matches) { delete document.body.dataset.rail; $("scrim").hidden = true; }
    syncInert();
  });

  $("railToggle").setAttribute("aria-expanded", "false");
  syncInert();

  $("railToggle").addEventListener("click", function () { setRail(true); });
  $("scrim").addEventListener("click", closeRail);

  document.querySelector(".views").addEventListener("click", function (e) {
    var b = e.target.closest(".view-btn");
    if (!b) return;
    state.view = b.dataset.view;
    closeRail();
    render();
  });

  $("agents").addEventListener("click", function (e) {
    var b = e.target.closest(".ag");
    if (!b) return;
    state.agent = state.agent === b.dataset.agent ? null : b.dataset.agent;
    closeRail();
    render();
  });

  $("layoutSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || b.dataset.layout === state.layout) return;
    state.layout = b.dataset.layout;
    try { localStorage.setItem("layout", state.layout); } catch (err) { /* storage can be blocked */ }
    render();
    b.focus();
  });

  $("filters").addEventListener("click", function (e) {
    var b = e.target.closest("[data-clear]");
    if (!b) return;
    var k = b.dataset.clear;
    if (k === "agent") state.agent = null;
    if (k === "project") state.project = null;
    if (k === "folder") { state.folder = null; scan(); return; }
    render();
    $("search").focus();
  });

  var searchTimer;
  $("search").addEventListener("input", function (e) {
    clearTimeout(searchTimer);
    var v = e.target.value;
    searchTimer = setTimeout(function () { state.q = v; render(); }, 70);
  });

  $("days").addEventListener("click", function (e) {
    var act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "clear") { clearAll(); return; }
    var row = e.target.closest(".row");
    if (!row) return;
    var f = state.sessions.filter(function (s) { return s.id === row.dataset.id; })[0];
    if (f) openSession(f, row);
  });

  $("projects").addEventListener("click", function (e) {
    var act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "clear") { clearAll(); return; }
    var row = e.target.closest(".prow, .pcard");
    if (!row) return;
    clearTimeout(searchTimer);
    state.project = row.dataset.project;
    state.view = "timeline";
    state.q = "";
    $("search").value = "";
    render();
    $("scroll").scrollTop = 0;
    $("title").tabIndex = -1;
    $("title").focus({ preventScroll: true });
  });

  /* the ribbon */
  var tip = $("tip");

  $("ribbon").addEventListener("pointerover", function (e) {
    var t = e.target.closest(".tick");
    if (!t) return;
    var n = +t.dataset.n;
    var r = t.getBoundingClientRect();
    tip.textContent = dayLabel(t.dataset.day) + ": " + n + (n === 1 ? " session" : " sessions");
    var w = tip.offsetWidth;
    var cx = Math.min(Math.max(r.left + r.width / 2, w / 2 + 8), innerWidth - w / 2 - 8);
    tip.style.left = cx + "px";
    tip.style.top = (r.top - 6) + "px";
    tip.classList.add("show");
  });
  $("ribbon").addEventListener("pointerleave", function () { tip.classList.remove("show"); });

  $("ribbon").addEventListener("click", function (e) {
    var t = e.target.closest(".tick");
    if (!t) return;
    var g = $("days").querySelector('.grp[data-day="' + t.dataset.day + '"]');
    if (!g) { toast("No sessions on that day for the current filters"); return; }
    $("scroll").scrollTo({ top: g.offsetTop, behavior: reduceMotion() ? "auto" : "smooth" });
  });

  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    var typing = tag === "INPUT" || tag === "TEXTAREA";

    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      $("search").focus();
      $("search").select();
      return;
    }

    if (e.key === "Escape") {
      if (document.body.dataset.rail === "open") { closeRail(); return; }
      if (typing && e.target === $("search") && $("search").value) {
        clearTimeout(searchTimer);
        $("search").value = "";
        state.q = "";
        render();
        return;
      }
      if (!$("insp").hidden) closeInspector();
      return;
    }

    var cl = e.target.classList;
    var isCard = cl && cl.contains("pcard");
    var keys = isCard ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] : ["ArrowUp", "ArrowDown"];
    if (cl && (cl.contains("row") || cl.contains("prow") || isCard) && keys.indexOf(e.key) >= 0) {
      var sel = cl.contains("row") ? "#days .row" : isCard ? "#projects .pcard" : "#projects .prow";
      var rows = Array.prototype.slice.call(document.querySelectorAll(sel));
      var at = rows.indexOf(e.target);
      var step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
      if (isCard && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        var cols = rows.filter(function (c) { return c.offsetTop === rows[0].offsetTop; }).length || 1;
        step *= cols;
      }
      var next = rows[at + step];
      if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: "nearest" }); }
    }
  });

  /* ---------- go ---------------------------------------------------------- */

  renderRail();
  render();
  scan();
})();
