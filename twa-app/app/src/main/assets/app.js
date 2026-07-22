/* Terminalapi — beginner-friendly learning terminal + Termux control panel.
 * Self-contained: the terminal is a teaching sandbox (it does not run a real
 * shell). Real execution is delegated to Termux through the native bridge. */
(function () {
  "use strict";

  /* ---------- Native bridge (guarded so it also works in a plain browser) ---------- */
  var HAS_BRIDGE = typeof Android !== "undefined";
  var bridge = {
    termuxInstalled: function () { return HAS_BRIDGE && Android.isTermuxInstalled(); },
    run: function (cmd, bg) {
      if (!HAS_BRIDGE) { alert("Termux bridge only works inside the app.\n\nWould run:\n" + cmd); return false; }
      return Android.runInTermux(cmd, !!bg);
    },
    openTermux: function () { if (HAS_BRIDGE) Android.openTermux(); },
    wakeOn: function () { return HAS_BRIDGE && Android.acquireWakeLock(); },
    wakeOff: function () { if (HAS_BRIDGE) Android.releaseWakeLock(); },
    wakeHeld: function () { return HAS_BRIDGE && Android.isWakeLockHeld(); },
    copy: function (t) { if (HAS_BRIDGE) Android.copyToClipboard(t); else navigator.clipboard && navigator.clipboard.writeText(t); },
    toast: function (m) { if (HAS_BRIDGE) Android.toast(m); }
  };

  /* ---------- Command knowledge base (drives Explain mode + `man`) ---------- */
  var COMMANDS = {
    pwd:   { sum: "Print the current directory (where you are).", usage: "pwd", flags: {} },
    ls:    { sum: "List files and folders here.", usage: "ls [-a] [-l] [path]",
             flags: { "-a": "also show hidden files (names starting with a dot)",
                      "-l": "long format: permissions, size, and name" } },
    cd:    { sum: "Change directory (move into a folder).", usage: "cd <folder>",
             flags: { "..": "go up one level to the parent folder", "~": "go to your home folder" } },
    cat:   { sum: "Show the contents of a file.", usage: "cat <file>", flags: {} },
    echo:  { sum: "Print text back to the screen (or into a file with >).", usage: "echo <text>",
             flags: { ">": "write the text into a file (overwrites it)",
                      ">>": "append the text to the end of a file" } },
    mkdir: { sum: "Make a new directory (folder).", usage: "mkdir <name>",
             flags: { "-p": "create parent folders as needed, no error if it exists" } },
    touch: { sum: "Create an empty file (or update its timestamp).", usage: "touch <file>", flags: {} },
    rm:    { sum: "Remove (delete) a file. Careful — there is no undo.", usage: "rm [-r] <target>",
             flags: { "-r": "recursive: delete a folder and everything inside it",
                      "-f": "force: never prompt, ignore missing files" } },
    cp:    { sum: "Copy a file or folder.", usage: "cp [-r] <src> <dest>",
             flags: { "-r": "copy a folder and its contents" } },
    mv:    { sum: "Move or rename a file/folder.", usage: "mv <src> <dest>", flags: {} },
    tree:  { sum: "Show folders and files as a tree.", usage: "tree", flags: {} },
    grep:  { sum: "Search for text inside a file.", usage: "grep <text> <file>",
             flags: { "-i": "case-insensitive search" } },
    head:  { sum: "Show the first lines of a file.", usage: "head <file>", flags: {} },
    tail:  { sum: "Show the last lines of a file.", usage: "tail <file>", flags: {} },
    whoami:{ sum: "Print your username.", usage: "whoami", flags: {} },
    date:  { sum: "Show the current date and time.", usage: "date", flags: {} },
    clear: { sum: "Clear the screen.", usage: "clear", flags: {} },
    man:   { sum: "Show the manual/help for a command.", usage: "man <command>", flags: {} },
    help:  { sum: "List what you can do here.", usage: "help", flags: {} }
  };

  /* ---------- Virtual filesystem (the safe practice sandbox) ---------- */
  function freshFS() {
    return {
      "projects": {
        "hello": { "README.md": "# Hello\nA tiny practice project.\n", "app.js": "console.log('hi');\n" }
      },
      "notes.txt": "Buy milk\nLearn bash\nShip the app\n",
      ".secret": "you found a hidden file!\n"
    };
  }
  var fs = freshFS();
  var cwd = ["~"];              // path segments; "~" is home
  var history = [];
  var histIdx = -1;

  /* navigate to a directory node given cwd (excluding leading ~) */
  function nodeAt(segs) {
    var node = fs;
    for (var i = 1; i < segs.length; i++) {
      if (node && typeof node === "object" && node[segs[i]] !== undefined) node = node[segs[i]];
      else return undefined;
    }
    return node;
  }
  function curDir() { return nodeAt(cwd); }
  function isDir(n) { return n && typeof n === "object"; }
  function cwdString() { return cwd.join("/").replace("~/", "~/").replace(/^~$/, "~"); }

  /* ---------- Screen output ---------- */
  var screen = document.getElementById("screen");
  function out(text, cls) {
    var div = document.createElement("div");
    div.className = "line " + (cls || "out");
    div.textContent = text;
    screen.appendChild(div);
    screen.scrollTop = screen.scrollHeight;
    return div;
  }
  function outHTML(html, cls) {
    var div = document.createElement("div");
    div.className = "line " + (cls || "out");
    div.innerHTML = html;
    screen.appendChild(div);
    screen.scrollTop = screen.scrollHeight;
  }

  /* ---------- Tokenizer (respects simple quotes) ---------- */
  function tokenize(str) {
    var re = /"([^"]*)"|'([^']*)'|(\S+)/g, m, toks = [];
    while ((m = re.exec(str)) !== null) toks.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    return toks;
  }

  /* ---------- Explain engine ---------- */
  function explain(tokens) {
    if (!tokens.length) return;
    var name = tokens[0];
    var info = COMMANDS[name];
    if (!info) { outHTML("<b>" + name + "</b> — not one of the practice commands. Type <b>help</b>.", "explain"); return; }
    var parts = ["<b>" + name + "</b> — " + info.sum];
    for (var i = 1; i < tokens.length; i++) {
      var t = tokens[i];
      var f = info.flags[t] || (t[0] === "-" ? info.flags[t] : null);
      if (f) parts.push("<span class='flag'>" + t + "</span> → " + f);
      else if (t[0] === "-") parts.push("<span class='flag'>" + t + "</span> → an option");
      else parts.push("<span class='flag'>" + t + "</span> → the target it acts on");
    }
    outHTML(parts.join("<br>"), "explain");
  }

  /* ---------- Command interpreter (the sandbox) ---------- */
  function run(raw) {
    var line = raw.trim();
    // echo the command
    outHTML("<span class='prompt'>" + promptStr() + "</span> " + escapeHTML(line), "cmd");
    if (line) { history.push(line); histIdx = history.length; }

    // lesson interception
    if (lesson.active) { lessonHandle(line); }
    else dispatch(line);
  }

  function dispatch(line) {
    if (!line) return;
    var toks = tokenize(line);
    var cmd = toks[0];
    var args = toks.slice(1);

    switch (cmd) {
      case "help": doHelp(); break;
      case "clear": screen.innerHTML = ""; break;
      case "pwd": out(fullPath()); break;
      case "ls": doLs(args); break;
      case "cd": doCd(args); break;
      case "cat": doCat(args); break;
      case "echo": doEcho(args, line); break;
      case "mkdir": doMkdir(args); break;
      case "touch": doTouch(args); break;
      case "rm": doRm(args); break;
      case "tree": doTree(); break;
      case "whoami": out("learner"); break;
      case "date": out(new Date().toString()); break;
      case "man": doMan(args); break;
      case "explain": explain(args.length ? args : []); if (!args.length) out("Usage: explain <command>", "err"); break;
      case "history": history.forEach(function (h, i) { out(("  " + (i + 1)).slice(-4) + "  " + h); }); break;
      case "learn": switchView("learn"); out("Opening the Learn tab — pick a lesson.", "sys"); break;
      case "termux":
        if (!args.length) { out("Usage: termux <command to run in Termux>", "err"); break; }
        var real = line.slice(line.indexOf("termux") + 7);
        if (bridge.run(real, false)) out("Sent to Termux: " + real, "sys");
        else out("Could not reach Termux.", "err");
        break;
      case "wakelock":
        if (args[0] === "on") { bridge.wakeOn(); refreshWake(); out("Wakelock ON — CPU stays awake.", "ok"); }
        else if (args[0] === "off") { bridge.wakeOff(); refreshWake(); out("Wakelock OFF.", "sys"); }
        else out("Usage: wakelock on | off", "err");
        break;
      case "exit": out("Nothing to exit here. (Inside a lesson, exit quits it.)", "sys"); break;
      default:
        out(cmd + ": command not found. Type 'help' to see what's available.", "err");
        return;
    }
    if (explainMode() && COMMANDS[cmd]) explain(toks);
  }

  /* ---------- Individual commands ---------- */
  function fullPath() { return "/home/" + cwd.slice(1).join("/"); }
  function promptStr() { return cwd[cwd.length - 1] + " $"; }

  function doLs(args) {
    var showAll = args.indexOf("-a") !== -1 || args.indexOf("-la") !== -1 || args.indexOf("-al") !== -1;
    var long = args.indexOf("-l") !== -1 || args.indexOf("-la") !== -1 || args.indexOf("-al") !== -1;
    var dir = curDir();
    if (!isDir(dir)) { out("not a directory", "err"); return; }
    var names = Object.keys(dir).filter(function (n) { return showAll || n[0] !== "."; });
    if (showAll) names = [".", ".."].concat(names);
    if (!names.length) { out("(empty)"); return; }
    if (long) {
      names.forEach(function (n) {
        var node = n === "." || n === ".." ? {} : dir[n];
        var d = isDir(node) ? "d" : "-";
        var size = isDir(node) ? "4096" : String((node || "").length);
        out(d + "rw-r--r--  learner  " + ("     " + size).slice(-6) + "  " + n + (isDir(node) ? "/" : ""));
      });
    } else {
      out(names.map(function (n) { return isDir(dir[n]) ? n + "/" : n; }).join("   "));
    }
  }

  function doCd(args) {
    if (!args.length || args[0] === "~") { cwd = ["~"]; return; }
    var target = args[0];
    if (target === "..") { if (cwd.length > 1) cwd.pop(); return; }
    if (target === ".") return;
    var dir = curDir();
    if (isDir(dir) && isDir(dir[target])) cwd.push(target);
    else out("cd: " + target + ": No such directory", "err");
  }

  function doCat(args) {
    if (!args.length) { out("Usage: cat <file>", "err"); return; }
    var dir = curDir(), f = dir[args[0]];
    if (f === undefined) out("cat: " + args[0] + ": No such file", "err");
    else if (isDir(f)) out("cat: " + args[0] + ": Is a directory", "err");
    else out(f.replace(/\n$/, ""));
  }

  function doEcho(args, line) {
    var gt = line.indexOf(">");
    if (gt !== -1) {
      var append = line.indexOf(">>") !== -1;
      var text = line.slice(line.indexOf("echo") + 4, gt).trim().replace(/^["']|["']$/g, "");
      var fname = line.slice(line.lastIndexOf(">") + 1).trim();
      var dir = curDir();
      if (!isDir(dir)) { out("no such directory", "err"); return; }
      dir[fname] = (append && typeof dir[fname] === "string" ? dir[fname] : "") + text + "\n";
    } else {
      out(args.join(" "));
    }
  }

  function doMkdir(args) {
    var names = args.filter(function (a) { return a[0] !== "-"; });
    if (!names.length) { out("Usage: mkdir <name>", "err"); return; }
    var dir = curDir();
    names.forEach(function (n) { if (dir[n] === undefined) dir[n] = {}; else out("mkdir: " + n + ": exists", "err"); });
  }

  function doTouch(args) {
    if (!args.length) { out("Usage: touch <file>", "err"); return; }
    var dir = curDir();
    args.forEach(function (n) { if (dir[n] === undefined) dir[n] = ""; });
  }

  function doRm(args) {
    var recursive = args.indexOf("-r") !== -1 || args.indexOf("-rf") !== -1 || args.indexOf("-fr") !== -1;
    var targets = args.filter(function (a) { return a[0] !== "-"; });
    if (!targets.length) { out("Usage: rm [-r] <target>", "err"); return; }
    var dir = curDir();
    targets.forEach(function (n) {
      if (dir[n] === undefined) out("rm: " + n + ": No such file", "err");
      else if (isDir(dir[n]) && !recursive) out("rm: " + n + ": is a directory (use -r)", "err");
      else delete dir[n];
    });
  }

  function doTree() {
    function walk(node, prefix) {
      var keys = Object.keys(node).filter(function (n) { return n[0] !== "."; });
      keys.forEach(function (k, i) {
        var last = i === keys.length - 1;
        out(prefix + (last ? "└── " : "├── ") + k + (isDir(node[k]) ? "/" : ""));
        if (isDir(node[k])) walk(node[k], prefix + (last ? "    " : "│   "));
      });
    }
    out(cwd[cwd.length - 1] + "/");
    walk(curDir(), "");
  }

  function doMan(args) {
    if (!args.length) { out("Usage: man <command>", "err"); return; }
    var info = COMMANDS[args[0]];
    if (!info) { out("No manual entry for " + args[0], "err"); return; }
    out(args[0].toUpperCase(), "sys");
    out("  " + info.sum);
    out("  Usage: " + info.usage);
    var fk = Object.keys(info.flags);
    if (fk.length) { out("  Options:"); fk.forEach(function (f) { out("    " + f + "   " + info.flags[f]); }); }
  }

  function doHelp() {
    out("Practice commands (safe sandbox):", "sys");
    out("  pwd  ls  cd  cat  echo  mkdir  touch  rm  cp  mv  tree  grep  head  tail");
    out("  whoami  date  history  man <cmd>  clear");
    out("Learning:", "sys");
    out("  learn            open the guided lessons");
    out("  explain <cmd>    describe a command without running it");
    out("  (toggle 'Explain mode' to auto-explain everything)");
    out("Real device (needs Termux):", "sys");
    out("  termux <cmd>     run a real command in Termux");
    out("  wakelock on|off  keep the CPU awake for servers");
  }

  function escapeHTML(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---------- Lessons ---------- */
  var LESSONS = [
    { id: "nav", title: "1 · Where am I?", steps: [
      { say: "Every shell has a \"current folder\". Type <b>pwd</b> to print it.", ok: function (c) { return c === "pwd"; }, hint: "Just type: pwd" },
      { say: "Now list what's in this folder. Type <b>ls</b>.", ok: function (c) { return c.split(" ")[0] === "ls"; }, hint: "Type: ls" },
      { say: "Hidden files start with a dot. Reveal them with <b>ls -a</b>.", ok: function (c) { return /^ls\s+-a/.test(c); }, hint: "Type: ls -a" }
    ]},
    { id: "move", title: "2 · Moving around", steps: [
      { say: "There's a folder called <b>projects</b>. Enter it: <b>cd projects</b>.", ok: function (c) { return /^cd\s+projects/.test(c); }, hint: "Type: cd projects" },
      { say: "Look inside with <b>ls</b>.", ok: function (c) { return c.split(" ")[0] === "ls"; }, hint: "Type: ls" },
      { say: "Go back up one level with <b>cd ..</b>", ok: function (c) { return /^cd\s+\.\./.test(c); }, hint: "Type: cd .." }
    ]},
    { id: "files", title: "3 · Reading & making files", steps: [
      { say: "Read the notes file: <b>cat notes.txt</b>.", ok: function (c) { return /^cat\s+notes\.txt/.test(c); }, hint: "Type: cat notes.txt" },
      { say: "Create an empty file: <b>touch todo.txt</b>.", ok: function (c) { return /^touch\s+todo\.txt/.test(c); }, hint: "Type: touch todo.txt" },
      { say: "Write into it: <b>echo hello &gt; todo.txt</b>.", ok: function (c) { return /^echo\s+.+>\s*todo\.txt/.test(c); }, hint: "Type: echo hello > todo.txt" },
      { say: "Check it worked: <b>cat todo.txt</b>.", ok: function (c) { return /^cat\s+todo\.txt/.test(c); }, hint: "Type: cat todo.txt" }
    ]},
    { id: "folders", title: "4 · Folders & cleanup", steps: [
      { say: "Make a folder: <b>mkdir sandbox</b>.", ok: function (c) { return /^mkdir\s+sandbox/.test(c); }, hint: "Type: mkdir sandbox" },
      { say: "See the whole tree: <b>tree</b>.", ok: function (c) { return c === "tree"; }, hint: "Type: tree" },
      { say: "Delete the folder: <b>rm -r sandbox</b>. (In real life, rm has no undo!)", ok: function (c) { return /^rm\s+-r\s+sandbox/.test(c); }, hint: "Type: rm -r sandbox" }
    ]}
  ];
  var lesson = { active: false, l: null, step: 0 };

  function startLesson(id) {
    var l = LESSONS.filter(function (x) { return x.id === id; })[0];
    if (!l) return;
    lesson = { active: true, l: l, step: 0 };
    switchView("terminal");
    outHTML("Lesson <b>" + l.title + "</b> started. Type <b>exit</b> anytime to quit.", "lesson");
    lessonPrompt();
  }
  function lessonPrompt() {
    outHTML("Step " + (lesson.step + 1) + "/" + lesson.l.steps.length + " — " + lesson.l.steps[lesson.step].say, "lesson");
  }
  function lessonHandle(line) {
    if (line === "exit") { lesson.active = false; out("Left the lesson. You're back in the free terminal.", "sys"); return; }
    dispatch(line);                          // run it for real in the sandbox
    var st = lesson.l.steps[lesson.step];
    if (st.ok(line.trim())) {
      out("✓ nice.", "ok");
      lesson.step++;
      if (lesson.step >= lesson.l.steps.length) {
        outHTML("🎉 Lesson complete: <b>" + lesson.l.title + "</b>. Try the next one in the Learn tab!", "lesson");
        lesson.active = false;
      } else lessonPrompt();
    } else {
      out("Not quite. Hint: " + st.hint, "sys");
    }
  }
  function renderLessons() {
    var box = document.getElementById("lessonList");
    box.innerHTML = "";
    LESSONS.forEach(function (l) {
      var card = document.createElement("div");
      card.className = "card";
      card.innerHTML = "<h3>" + l.title + "</h3><p>" + l.steps.length + " steps</p>";
      var b = document.createElement("button");
      b.className = "btn primary"; b.textContent = "Start";
      b.onclick = function () { startLesson(l.id); };
      var row = document.createElement("div"); row.className = "btnrow"; row.appendChild(b);
      card.appendChild(row); box.appendChild(card);
    });
  }

  /* ---------- Servers ---------- */
  var SKEY = "terminalapi.servers";
  var PRESETS = [
    { name: "Python simple server", cmd: "termux-wake-lock; cd ~ && python -m http.server 8080 --bind 0.0.0.0" },
    { name: "Node / Vite dev", cmd: "termux-wake-lock; cd ~/myproject && npm run dev -- --host" },
    { name: "Node app.js", cmd: "termux-wake-lock; cd ~/myproject && node app.js" },
    { name: "PHP built-in server", cmd: "termux-wake-lock; cd ~/site && php -S 0.0.0.0:8000" }
  ];
  function loadServers() { try { return JSON.parse(localStorage.getItem(SKEY)) || []; } catch (e) { return []; } }
  function saveServers(a) { localStorage.setItem(SKEY, JSON.stringify(a)); }

  function renderServers() {
    var box = document.getElementById("serverList");
    var list = loadServers();
    box.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "card"; empty.innerHTML = "<p>No servers saved yet. Add one below, or load a preset.</p>";
      box.appendChild(empty);
    }
    list.forEach(function (s, idx) {
      var card = document.createElement("div");
      card.className = "card";
      card.innerHTML = "<h3>" + escapeHTML(s.name) + "</h3><div class='cmd-preview'>" + escapeHTML(s.cmd) + "</div>";
      var row = document.createElement("div"); row.className = "btnrow";
      row.appendChild(mkBtn("▶ Run in Termux", "btn primary", function () {
        if (bridge.run(s.cmd, false)) bridge.toast("Launched: " + s.name);
      }));
      row.appendChild(mkBtn("Copy", "btn", function () { bridge.copy(s.cmd); bridge.toast("Copied"); }));
      row.appendChild(mkBtn("Delete", "btn danger", function () {
        var l = loadServers(); l.splice(idx, 1); saveServers(l); renderServers();
      }));
      card.appendChild(row); box.appendChild(card);
    });
    renderTermuxBanner();
  }
  function mkBtn(label, cls, fn) { var b = document.createElement("button"); b.className = cls; b.type = "button"; b.textContent = label; b.onclick = fn; return b; }

  function renderTermuxBanner() {
    var el = document.getElementById("termuxBanner");
    if (!HAS_BRIDGE) { el.innerHTML = "<div class='banner warn'>Running outside the app — Termux actions are simulated.</div>"; return; }
    if (bridge.termuxInstalled()) {
      el.innerHTML = "<div class='banner ok'>Termux detected ✓ &nbsp; If launching fails, run once in Termux:<br>" +
        "<code>echo \"allow-external-apps=true\" &gt;&gt; ~/.termux/termux.properties</code></div>";
    } else {
      el.innerHTML = "<div class='banner warn'>Termux not detected. Install it from F-Droid or github.com/termux/termux-app to run real servers.</div>";
    }
  }

  /* ---------- Wakelock UI ---------- */
  function refreshWake() {
    var held = bridge.wakeHeld();
    var pill = document.getElementById("wakePill");
    var label = document.getElementById("wakeLabel");
    pill.className = "wake-pill" + (held ? " on" : "");
    label.textContent = held ? "Awake" : "Wakelock";
  }

  /* ---------- Help ---------- */
  function renderHelp() {
    document.getElementById("helpBody").innerHTML =
      "<div class='card'><h3>What this app is</h3>" +
      "<p>The <b>Terminal</b> and <b>Learn</b> tabs are a safe sandbox to learn bash — nothing there touches your phone. " +
      "The <b>Servers</b> tab runs <i>real</i> commands through Termux.</p></div>" +

      "<div class='card'><h3>One-time Termux setup</h3>" +
      "<p>So this app can launch servers in Termux, run this once in Termux:</p>" +
      "<div class='cmd-preview'>echo \"allow-external-apps=true\" >> ~/.termux/termux.properties</div></div>" +

      "<div class='card'><h3>Fix: nothing installs in Termux</h3>" +
      "<p>Your package mirror may be far away/offline. Pick a closer one:</p>" +
      "<div class='cmd-preview'>termux-change-repo</div>" +
      "<p>Then: <span style='color:var(--cyan)'>pkg update &amp;&amp; pkg upgrade</span></p></div>" +

      "<div class='card'><h3>Fix: my server keeps dying (Android 12+)</h3>" +
      "<p>Android kills background processes. Do all three:</p>" +
      "<p>1. Settings → Apps → Termux → Battery → <b>Unrestricted</b>.<br>" +
      "2. Turn on <b>Wakelock</b> (top-right) + use <code>termux-wake-lock</code>.<br>" +
      "3. From a PC over USB, once:</p>" +
      "<div class='cmd-preview'>adb shell \"settings put global settings_enable_monitor_phantom_procs false\"</div></div>" +

      "<div class='card'><h3>Trustworthy Termux</h3>" +
      "<p>Only from <b>F-Droid</b> or <b>github.com/termux/termux-app/releases</b>. Never the Play Store version. " +
      "Install Termux and Termux:API from the <i>same</i> source.</p></div>";
  }

  /* ---------- Navigation ---------- */
  function switchView(name) {
    var views = document.querySelectorAll(".view");
    for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
    document.getElementById("view-" + name).classList.add("active");
    var btns = document.querySelectorAll("nav button");
    for (var j = 0; j < btns.length; j++) btns[j].classList.toggle("active", btns[j].getAttribute("data-view") === name);
    if (name === "servers") renderServers();
    if (name === "help") renderHelp();
    if (name === "terminal") document.getElementById("cmdInput").focus();
  }

  /* ---------- Explain toggle ---------- */
  function explainMode() { return document.getElementById("explainToggle").checked; }

  /* ---------- Command chips ---------- */
  var CHIPS = ["help", "ls", "ls -a", "pwd", "cd projects", "cat notes.txt", "tree", "mkdir demo", "clear", "learn"];
  function renderChips() {
    var box = document.getElementById("chips");
    CHIPS.forEach(function (c) {
      var b = document.createElement("button");
      b.className = "chip"; b.type = "button"; b.textContent = c;
      b.onclick = function () { var inp = document.getElementById("cmdInput"); inp.value = c; inp.focus(); };
      box.appendChild(b);
    });
  }

  /* ---------- Wire up events ---------- */
  function submit() {
    var inp = document.getElementById("cmdInput");
    var v = inp.value;
    if (!v.trim()) return;
    run(v);
    inp.value = "";
    refreshWake();
  }

  function init() {
    renderChips();
    renderLessons();
    outHTML("<b style='color:var(--green)'>Welcome to Terminalapi</b>", "sys");
    out("A friendly place to learn bash — then launch real servers via Termux.");
    out("Type 'help', tap a chip below, or open the Learn tab to start a lesson.");
    out("");

    document.getElementById("runBtn").onclick = submit;
    document.getElementById("cmdInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { submit(); }
      else if (e.key === "ArrowUp") { if (histIdx > 0) { histIdx--; this.value = history[histIdx] || ""; } e.preventDefault(); }
      else if (e.key === "ArrowDown") { if (histIdx < history.length - 1) { histIdx++; this.value = history[histIdx] || ""; } else { histIdx = history.length; this.value = ""; } e.preventDefault(); }
    });

    // nav
    var navBtns = document.querySelectorAll("nav button");
    for (var i = 0; i < navBtns.length; i++) {
      navBtns[i].onclick = function () { switchView(this.getAttribute("data-view")); };
    }

    // wakelock buttons
    document.getElementById("wakePill").onclick = function () {
      if (bridge.wakeHeld()) bridge.wakeOff(); else bridge.wakeOn();
      refreshWake();
    };
    document.getElementById("wakeOnBtn").onclick = function () { bridge.wakeOn(); refreshWake(); bridge.toast("Wakelock ON"); };
    document.getElementById("wakeOffBtn").onclick = function () { bridge.wakeOff(); refreshWake(); bridge.toast("Wakelock OFF"); };
    document.getElementById("termuxWakeBtn").onclick = function () { bridge.run("termux-wake-lock", true); bridge.toast("termux-wake-lock sent"); };

    // servers add / preset
    document.getElementById("srvAddBtn").onclick = function () {
      var name = document.getElementById("srvName").value.trim();
      var cmd = document.getElementById("srvCmd").value.trim();
      if (!name || !cmd) { bridge.toast("Enter a name and a command"); return; }
      var list = loadServers(); list.push({ name: name, cmd: cmd }); saveServers(list);
      document.getElementById("srvName").value = ""; document.getElementById("srvCmd").value = "";
      renderServers();
    };
    document.getElementById("srvPresetBtn").onclick = function () {
      var p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
      document.getElementById("srvName").value = p.name;
      document.getElementById("srvCmd").value = p.cmd;
    };

    refreshWake();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
