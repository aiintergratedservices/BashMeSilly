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
    tail:  { sum: "Show the last lines of a file.", usage: "tail [-n N] <file>", flags: { "-n": "how many lines to show" } },
    wc:    { sum: "Count lines, words, and characters in a file.", usage: "wc [-l|-w|-c] <file>",
             flags: { "-l": "count lines only", "-w": "count words only", "-c": "count characters only" } },
    sort:  { sum: "Sort the lines of a file.", usage: "sort [-r] [-n] <file>",
             flags: { "-r": "reverse order", "-n": "numeric sort" } },
    uniq:  { sum: "Collapse adjacent duplicate lines (sort first!).", usage: "uniq [-c] <file>",
             flags: { "-c": "show a count next to each line" } },
    find:  { sum: "Search for files/folders by name, from here downward.", usage: "find . -name <pattern>",
             flags: { "-name": "match filenames (use * as a wildcard)" } },
    chmod: { sum: "Change a file's permissions (who can read/write/run it).", usage: "chmod <mode> <file>",
             flags: { "+x": "make it executable", "755": "owner all, others read+run" } },
    which: { sum: "Show the path of a command.", usage: "which <command>", flags: {} },
    whoami:{ sum: "Print your username.", usage: "whoami", flags: {} },
    date:  { sum: "Show the current date and time.", usage: "date", flags: {} },
    clear: { sum: "Clear the screen.", usage: "clear", flags: {} },
    man:   { sum: "Show the manual/help for a command.", usage: "man <command>", flags: {} },
    help:  { sum: "List what you can do here.", usage: "help", flags: {} },

    /* --- security / pentest tools (explained here; simulated in the lab) --- */
    nmap:  { sum: "Network mapper: discover hosts and scan for open ports/services. The recon workhorse.",
             usage: "nmap [options] <target>", cat: "recon",
             flags: { "-sn": "ping scan: find live hosts, no port scan",
                      "-sV": "detect the service + version behind each open port",
                      "-p-": "scan all 65535 ports (default is top 1000)",
                      "-A": "aggressive: OS detect, versions, scripts, traceroute",
                      "-T4": "faster timing (fine on a LAN you own)",
                      "-oN": "save normal output to a file" } },
    nikto: { sum: "Web server scanner: checks for known-vulnerable files, misconfigs, outdated software.",
             usage: "nikto -h <url>", cat: "web", flags: { "-h": "the host/URL to scan" } },
    gobuster:{ sum: "Brute-forces hidden web paths/files and DNS subdomains from a wordlist.",
             usage: "gobuster dir -u <url> -w <wordlist>", cat: "web",
             flags: { "dir": "directory/file enumeration mode", "-u": "target URL", "-w": "wordlist file" } },
    sqlmap:{ sum: "Automates finding and exploiting SQL injection in web apps.",
             usage: "sqlmap -u <url> --batch", cat: "web",
             flags: { "-u": "target URL with a parameter", "--batch": "assume defaults, no prompts",
                      "--dbs": "list databases once injectable" } },
    hydra: { sum: "Online password brute-forcer for login services (SSH, FTP, HTTP forms...).",
             usage: "hydra -l <user> -P <wordlist> <target> <service>", cat: "access",
             flags: { "-l": "single username", "-P": "password wordlist", "-t": "parallel tasks" } },
    hashcat:{ sum: "Offline password-hash cracker (GPU-accelerated).",
             usage: "hashcat -m <mode> <hashfile> <wordlist>", cat: "access",
             flags: { "-m": "hash type (e.g. 0 = MD5)", "-a": "attack mode (0 = wordlist)" } },
    msfconsole:{ sum: "Metasploit Framework: search, configure, and launch exploits + payloads.",
             usage: "msfconsole", cat: "exploit",
             flags: { "search": "find a module", "use": "select a module",
                      "set": "set an option (RHOSTS, LHOST...)", "run/exploit": "launch it" } },
    nc:    { sum: "Netcat: raw TCP/UDP connections — banner grabbing, listeners, reverse shells (in a lab).",
             usage: "nc [-lvnp] <host> <port>", cat: "access",
             flags: { "-l": "listen mode", "-v": "verbose", "-n": "no DNS", "-p": "port" } },
    whatweb:{ sum: "Fingerprints a website: server, CMS, frameworks, versions.",
             usage: "whatweb <url>", cat: "recon", flags: {} },
    searchsploit:{ sum: "Search the local Exploit-DB copy for public exploits by product/version.",
             usage: "searchsploit <product version>", cat: "exploit", flags: {} },
    smbclient:{ sum: "Connect to / list Windows/Samba (SMB) file shares.",
             usage: "smbclient -L <host>", cat: "recon",
             flags: { "-L": "list available shares", "-N": "no password (null session)" } },
    enum4linux:{ sum: "Enumerate SMB: shares, users, groups, OS info — great for null sessions.",
             usage: "enum4linux <host>", cat: "recon", flags: {} },
    ftp:   { sum: "Connect to an FTP server (check for anonymous login + risky versions).",
             usage: "ftp <host>", cat: "recon", flags: {} },
    john:  { sum: "John the Ripper: offline password-hash cracker (CPU-based).",
             usage: "john --wordlist=<list> <hashfile>", cat: "access", flags: {} },
    scope: { sum: "Show the rules of engagement — who/what you're allowed to test.",
             usage: "scope", cat: "ethics", flags: {} }
  };

  /* ---------- Virtual filesystem (the safe practice sandbox) ---------- */
  function freshFS() {
    return {
      "projects": {
        "hello": { "README.md": "# Hello\nA tiny practice project.\n", "app.js": "console.log('hi');\n" },
        "site":  { "index.html": "<h1>Hi</h1>\n", "style.css": "body{margin:0}\n" }
      },
      "notes.txt": "Buy milk\nLearn bash\nShip the app\nCall mom\nBuy milk again\n",
      "fruits.txt": "banana\napple\ncherry\napple\ndate\nbanana\napple\n",
      "log.txt": "INFO server started\nWARN low disk\nERROR db timeout\nINFO request ok\nERROR db timeout\nWARN low disk\n",
      "poem.txt": "roses are red\nviolets are blue\nbash is fun\nand so are you\n",
      "readme.md": "# Sandbox\nA safe place to practice.\n\n## Files\n- notes.txt\n- log.txt\n",
      ".secret": "you found a hidden file!\n"
    };
  }
  var fs = freshFS();
  var cwd = ["~"];              // path segments; "~" is home
  var history = [];
  var histIdx = -1;

  /* ---------- Offline session persistence ----------
   * The sandbox filesystem, command history, lesson progress, the Explain
   * toggle, and the on-screen transcript all survive app restarts via
   * localStorage — so your offline work is never lost. Everything here is
   * local-only: no network, works fully offline. */
  var PERSIST = {
    fs:       "terminalapi.fs",       // sandbox filesystem + current directory
    history:  "terminalapi.history",  // command history (recalled with up/down)
    progress: "terminalapi.progress", // completed lesson ids
    explain:  "terminalapi.explain",  // Explain-mode toggle state
    screen:   "terminalapi.screen"    // last session transcript (resume on launch)
  };
  var HISTORY_CAP = 300;   // keep the last N commands
  var SCREEN_CAP = 300;    // keep the last N transcript lines

  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function readJSON(k, dflt) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? dflt : v; }
    catch (e) { return dflt; }
  }

  function persistSandbox() { saveJSON(PERSIST.fs, { fs: fs, cwd: cwd }); }
  function persistHistory() { saveJSON(PERSIST.history, history.slice(-HISTORY_CAP)); }
  function persistScreen() {
    if (!screen) return;
    while (screen.children.length > SCREEN_CAP) screen.removeChild(screen.firstChild);
    try { localStorage.setItem(PERSIST.screen, screen.innerHTML); } catch (e) {}
  }
  function persistSession() { persistSandbox(); persistHistory(); persistScreen(); }

  function loadProgress() { return readJSON(PERSIST.progress, {}); }
  function markLessonComplete(id) { var p = loadProgress(); p[id] = true; saveJSON(PERSIST.progress, p); }

  /* Restore saved state on launch. Returns the previous transcript HTML (if any)
   * so init() can replay the session instead of showing the welcome banner. */
  function restoreSession() {
    var s = readJSON(PERSIST.fs, null);
    if (s && s.fs && typeof s.fs === "object") {
      fs = s.fs;
      cwd = (s.cwd && s.cwd.length) ? s.cwd : ["~"];
    }
    var h = readJSON(PERSIST.history, null);
    if (h && h.length) { history = h; histIdx = history.length; }
    var ex = null;
    try { ex = localStorage.getItem(PERSIST.explain); } catch (e) {}
    if (ex === "1") { var t = document.getElementById("explainToggle"); if (t) t.checked = true; }
    var prev = null;
    try { prev = localStorage.getItem(PERSIST.screen); } catch (e) {}
    return prev;
  }

  function resetSandbox() { fs = freshFS(); cwd = ["~"]; persistSandbox(); }

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

    persistSession();   // save sandbox + history + transcript after every command
    if (autoCoachEnabled()) kCoach(false);   // let Kortana watch & guide as you work
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
      case "cp": doCp(args); break;
      case "mv": doMv(args); break;
      case "grep": doGrep(args, line); break;
      case "head": doHeadTail("head", args); break;
      case "tail": doHeadTail("tail", args); break;
      case "wc": doWc(args); break;
      case "sort": doSort(args); break;
      case "uniq": doUniq(args); break;
      case "find": doFind(args); break;
      case "chmod": doChmod(args); break;
      case "which": doWhich(args); break;
      case "whoami": out("learner"); break;
      case "date": out(new Date().toString()); break;
      case "man": doMan(args); break;
      case "explain": explain(args.length ? args : []); if (!args.length) out("Usage: explain <command>", "err"); break;
      case "history": history.forEach(function (h, i) { out(("  " + (i + 1)).slice(-4) + "  " + h); }); break;
      case "learn": switchView("learn"); out("Opening the Learn tab — pick a lesson.", "sys"); break;
      case "sessions": doSessions(); break;
      case "reset": resetSandbox(); out("Sandbox filesystem reset to a fresh state.", "ok"); break;
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
      case "pentest": case "security": doPentestIntro(); break;
      case "scope": doScope(); break;
      case "nmap": doNmap(args); break;
      case "nikto": case "whatweb": case "gobuster": case "sqlmap":
        doWebTool(cmd, args); break;
      case "searchsploit": doSearchsploit(args); break;
      case "hydra": doHydra(args); break;
      case "smbclient": case "enum4linux": doSmb(cmd, args); break;
      case "nc": case "netcat": doNc(args); break;
      case "ftp": doFtp(args); break;
      case "hashcat": case "john": doCrack(cmd, args); break;
      case "msfconsole": case "msf": doMsf(args); break;
      case "exit": out("Nothing to exit here. (Inside a lesson, exit quits it.)", "sys"); break;
      default:
        out(cmd + ": command not found. Type 'help' to see what's available.", "err");
        return;
    }
    if (explainMode() && COMMANDS[cmd]) explain(toks);
  }

  /* ---------- Pentest learning sandbox (fully offline, fully simulated) ----------
   * Nothing here touches a real network. It models a small practice lab so you can
   * learn the recon workflow and read tool output without any internet or targets. */
  var LAB_NET = "192.168.56.0/24";
  var LAB = {
    "192.168.56.1":  { name: "kali-you",   ports: [] },
    "192.168.56.10": { name: "target-web", ports: [
      { p: 22,  svc: "ssh",  ver: "OpenSSH 8.2p1" },
      { p: 80,  svc: "http", ver: "Apache 2.4.41 (Juice Shop behind it)" },
      { p: 3000,svc: "http", ver: "Node.js Express (OWASP Juice Shop)" } ] },
    "192.168.56.20": { name: "target-smb", ports: [
      { p: 22,  svc: "ssh",  ver: "OpenSSH 7.6p1" },
      { p: 139, svc: "netbios-ssn", ver: "Samba smbd 4.x" },
      { p: 445, svc: "microsoft-ds", ver: "Samba smbd 4.7.6" } ] },
    "192.168.56.101":{ name: "metasploitable", ports: [
      { p: 21,  svc: "ftp",  ver: "vsftpd 2.3.4  (!! backdoored version)" },
      { p: 22,  svc: "ssh",  ver: "OpenSSH 4.7p1" },
      { p: 23,  svc: "telnet", ver: "Linux telnetd" },
      { p: 80,  svc: "http", ver: "Apache 2.2.8 (DVWA)" },
      { p: 3306,svc: "mysql",ver: "MySQL 5.0.51a" } ] }
  };
  function inLab(target) {
    return target && (target.indexOf("192.168.56.") === 0 || target === LAB_NET);
  }

  function doScope() {
    outHTML("<b>RULES OF ENGAGEMENT — read before you ever run a tool</b>", "lesson");
    out("1. Only test systems you OWN or have WRITTEN permission to test.", "ok");
    out("2. Stay inside your agreed scope (these IPs, these times). Never wander.", "ok");
    out("3. On a shared/hotspot network, other people's devices are OFF-limits.", "ok");
    out("4. Don't destroy data or knock services offline unless the scope says so.", "ok");
    out("5. Keep notes: what you did, when, and what you found (for the report).", "ok");
    out("Unauthorized scanning/attacking is a crime. In here it's simulated so you", "sys");
    out("can practice safely. Your real practice lab: " + LAB_NET + " (your own gear).", "sys");
  }

  function doPentestIntro() {
    outHTML("<b>PENTEST TRACK — the methodology</b> (offline practice)", "lesson");
    out("The standard flow, each step feeding the next:", "sys");
    out("  1. scope       define what you're allowed to touch   (type: scope)");
    out("  2. recon       find hosts + open services            (nmap -sn " + LAB_NET + ")");
    out("  3. enumerate   dig into each service                 (nmap -sV <ip>)");
    out("  4. exploit     abuse a weakness to get access        (msfconsole, sqlmap…)");
    out("  5. post-exploit  loot, pivot, persist                (in your Kali lab)");
    out("  6. report      write up findings + fixes");
    out("Try it now:  scope   →   nmap -sn " + LAB_NET + "   →   nmap -sV 192.168.56.10", "ok");
    out("Or open the Learn tab for the guided Pentest lessons.", "sys");
  }

  function doNmap(args) {
    var target = args[args.length - 1] || "";
    var flags = args.slice(0, -1);
    if (!target || target[0] === "-") { out("Usage: nmap [-sn|-sV|-p-] <target>", "err"); return; }
    if (!inLab(target)) {
      out("nmap: refusing to 'scan' " + target + " — this sandbox only simulates your", "err");
      out("practice lab (" + LAB_NET + "). Only scan systems you own or are authorized to test.", "err");
      out("Run real scans against your own hosts from Kali/Termux. Try: nmap -sn " + LAB_NET, "sys");
      return;
    }
    out("Starting Nmap (simulated) against " + target, "sys");
    // host discovery
    if (flags.indexOf("-sn") !== -1 || target === LAB_NET) {
      out("Host discovery on " + LAB_NET + ":");
      Object.keys(LAB).forEach(function (ip) {
        out("  " + ip + "  is up   (" + LAB[ip].name + ")");
      });
      out(Object.keys(LAB).length + " hosts up. Next: pick one and run  nmap -sV <ip>", "ok");
      return;
    }
    // single-host scan
    var host = LAB[target];
    if (!host) { out("Note: host down / not in the lab. Live hosts: run nmap -sn " + LAB_NET, "err"); return; }
    if (args.indexOf("vuln") !== -1 || flags.indexOf("--script") !== -1) {
      out("Nmap scan report for " + host.name + " (" + target + ")  [NSE: vuln]", "sys");
      var V = {
        "192.168.56.10":  ["80/tcp   http: CVE-2021-XXXX possible; outdated Apache 2.4.41",
                            "3000/tcp Juice Shop: multiple OWASP issues (SQLi, XSS, broken access control)"],
        "192.168.56.20":  ["445/tcp  smb-vuln: null session allowed; SMB signing not required"],
        "192.168.56.101": ["21/tcp   ftp-vuln: vsftpd 2.3.4 BACKDOOR (CVE-2011-2523) — instant root shell",
                            "3306/tcp mysql: default/weak credentials likely",
                            "80/tcp   http: DVWA present (deliberately vulnerable)"]
      };
      (V[target] || ["No high-signal script findings on this host."]).forEach(function (l) { out("| " + l, "ok"); });
      out("Version + vuln info feeds the next phase: searchsploit / msfconsole.", "sys");
      return;
    }
    var allPorts = flags.indexOf("-p-") !== -1;
    var showVer = flags.indexOf("-sV") !== -1 || flags.indexOf("-A") !== -1;
    out("Nmap scan report for " + host.name + " (" + target + ")");
    if (!host.ports.length) { out("All scanned ports closed. (This is your own box.)"); return; }
    out("PORT      STATE  SERVICE" + (showVer ? "       VERSION" : ""));
    host.ports.forEach(function (pt) {
      var line = (pt.p + "/tcp").padEnd ? (pt.p + "/tcp").padEnd(9) : (pt.p + "/tcp      ").slice(0, 9);
      out(line + " open   " + (showVer ? (pt.svc + "  " + pt.ver) : pt.svc));
    });
    if (!showVer) out("Tip: add -sV to fingerprint versions:  nmap -sV " + target, "sys");
    else out("Attack surface found. Web ports (80/3000) → try a web tool: whatweb / nikto.", "ok");
  }

  function doWebTool(tool, args) {
    var url = args[args.length - 1] || "";
    var host = url.replace(/^https?:\/\//, "").split(/[:/]/)[0];
    if (!inLab(host)) {
      out(tool + ": sandbox only models your lab web target at 192.168.56.10.", "err");
      out("Try:  " + tool + " 192.168.56.10   (only scan sites you own/are authorized to test.)", "sys");
      return;
    }
    if (tool === "whatweb") {
      out("http://192.168.56.10 [200 OK]  Apache/2.4.41, Node.js Express, OWASP-Juice-Shop", "ok");
    } else if (tool === "nikto") {
      out("+ Server: Apache/2.4.41", "ok");
      out("+ /ftp/: potentially interesting directory listing enabled");
      out("+ Outdated component detected. Enumerate further with gobuster.");
    } else if (tool === "gobuster") {
      ["/login (200)", "/admin (301)", "/ftp (200)", "/rest (200)", "/api (200)"].forEach(function (p) { out("Found: " + p); });
    } else if (tool === "sqlmap") {
      out("[*] testing parameter 'q' ...", "sys");
      out("[+] parameter 'q' is vulnerable (boolean-based blind).  In a real lab: --dbs to dump.", "ok");
    }
    out("(Simulated result — run the real tool from Kali against your own target.)", "sys");
  }

  function labGate(tool, target) {
    if (inLab(target)) return true;
    out(tool + ": sandbox only models the practice lab (" + LAB_NET + ").", "err");
    out("Only test systems you own or are authorized to test. Try a 192.168.56.x lab host.", "sys");
    return false;
  }

  function doSearchsploit(args) {
    var q = args.join(" ").toLowerCase();
    if (!q) { out("Usage: searchsploit <product version>   e.g. searchsploit vsftpd 2.3.4", "err"); return; }
    out("--------------------------------------------  ----------------------------", "sys");
    out(" Exploit Title                                | Path");
    out("--------------------------------------------  ----------------------------", "sys");
    if (/vsftpd/.test(q)) {
      out(" vsftpd 2.3.4 - Backdoor Command Execution    | unix/remote/17491.rb", "ok");
      out("Match! This maps to a Metasploit module. Next: msfconsole → search vsftpd.", "ok");
    } else if (/samba|smb/.test(q)) {
      out(" Samba 3.x - 'Username map script' RCE        | unix/remote/16320.rb", "ok");
    } else if (/apache/.test(q)) {
      out(" Apache 2.4.x - various (context dependent)   | multiple/...");
    } else {
      out(" (no exact match — try the exact product + version string)");
    }
    out("(Simulated Exploit-DB — verify real results with the actual searchsploit in Kali.)", "sys");
  }

  function doHydra(args) {
    var target = null, svc = "ssh";
    args.forEach(function (a) { if (/^192\.168\.56\./.test(a)) target = a; if (/^(ssh|ftp|http)/.test(a)) svc = a; });
    if (!labGate("hydra", target)) return;
    out("Hydra starting (simulated) — brute-forcing " + svc + " on " + target + " ...", "sys");
    out("[ATTEMPT] target " + target + " - login \"admin\" - pass \"123456\"");
    out("[ATTEMPT] target " + target + " - login \"admin\" - pass \"password\"");
    out("[" + (svc === "ssh" ? "22" : "21") + "][" + svc + "] host: " + target + "   login: msfadmin   password: msfadmin", "ok");
    out("1 valid password found. Weak/default creds = game over.", "ok");
    out("🛡️ Defense: enforce MFA, lockouts + rate-limiting, and ban weak/default passwords.", "sys");
  }

  function doSmb(tool, args) {
    var target = args.filter(function (a) { return /^192\.168\.56\./.test(a); })[0];
    if (!labGate(tool, target)) return;
    out("Enumerating SMB on " + target + " (simulated) ...", "sys");
    out("  Sharename       Type      Comment");
    out("  ---------       ----      -------");
    out("  print$          Disk      Printer Drivers");
    out("  tmp             Disk      oh noes!   (world-readable)", "ok");
    out("  IPC$            IPC       IPC Service");
    out("[+] Null session allowed — anonymous access to 'tmp'.", "ok");
    out("🛡️ Defense: disable null sessions, require SMB signing, restrict share permissions.", "sys");
  }

  function doNc(args) {
    var target = args.filter(function (a) { return /^192\.168\.56\./.test(a); })[0];
    var port = args.filter(function (a) { return /^\d+$/.test(a); })[0] || "80";
    if (!labGate("nc", target)) return;
    out("Connecting to " + target + ":" + port + " (simulated banner grab) ...", "sys");
    var banners = { "21": "220 (vsFTPd 2.3.4)", "22": "SSH-2.0-OpenSSH_7.6p1", "80": "HTTP/1.1 200 OK  Server: Apache/2.4.41", "3306": "5.0.51a-3ubuntu5 (MySQL)" };
    out(banners[port] || "(no banner / closed)", "ok");
    out("Banner = free version intel → feed it to searchsploit.", "sys");
  }

  function doFtp(args) {
    var target = args.filter(function (a) { return /^192\.168\.56\./.test(a); })[0];
    if (!labGate("ftp", target)) return;
    out("Connected to " + target + ".  220 (vsFTPd 2.3.4)", "sys");
    out("Name: anonymous   Password: (blank)");
    out("230 Login successful.   ← anonymous FTP is enabled", "ok");
    if (target === "192.168.56.101") out("⚠ vsFTPd 2.3.4 is the BACKDOORED build (CVE-2011-2523). searchsploit vsftpd 2.3.4", "ok");
    out("🛡️ Defense: disable anonymous FTP, patch/replace vulnerable versions, prefer SFTP.", "sys");
  }

  function doCrack(tool, args) {
    out(tool + " starting (simulated) ...", "sys");
    out("Loaded 1 hash (md5).  Wordlist: rockyou.txt", "sys");
    out("5f4dcc3b5aa765d61d8327deb882cf99 : password", "ok");
    out("Cracked! MD5 is unsalted and instant to crack.", "ok");
    out("🛡️ Defense: never store MD5/SHA1 for passwords — use salted bcrypt/argon2.", "sys");
  }

  function doMsf(args) {
    out("Metasploit is interactive — here's the flow you'd run in your Kali box:", "sys");
    out("  msf6 > search vsftpd 2.3.4");
    out("  msf6 > use exploit/unix/ftp/vsftpd_234_backdoor");
    out("  msf6 > set RHOSTS 192.168.56.101");
    out("  msf6 > exploit");
    out("[*] (in a real lab) Command shell session 1 opened — you have root.", "ok");
    out("🛡️ Defense: patch the CVE, EDR to catch payloads, egress filtering to block the shell.", "sys");
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
    out("  wc  sort  uniq  find  chmod  which     (text & file power tools)");
    out("Your offline session (saved on this device):", "sys");
    out("  sessions         show what's saved (history, progress, files)");
    out("  reset            wipe the sandbox filesystem back to fresh");
    out("Learning:", "sys");
    out("  learn            open the guided lessons");
    out("  explain <cmd>    describe a command without running it");
    out("  (toggle 'Explain mode' to auto-explain everything)");
    out("Security / pentest (simulated lab, offline):", "sys");
    out("  pentest          the attack methodology, top to bottom");
    out("  scope            the rules of engagement (read first!)");
    out("  nmap -sn 192.168.56.0/24     discover lab hosts");
    out("  nmap -sV / -p- / --script vuln <ip>   scan & find weaknesses");
    out("  whatweb/nikto/gobuster/sqlmap <ip>    web recon & injection");
    out("  nc <ip> <port>   banner grab      ftp <ip>   anonymous FTP");
    out("  enum4linux/smbclient <ip>   SMB      hydra <ip> ssh   brute force");
    out("  searchsploit <product>   find exploits    msfconsole   exploit flow");
    out("  hashcat/john <hashes>    crack password hashes");
    out("  (Learn tab: 14 guided Pentest lessons + the in-depth Field Guide)");
    out("Real device (needs Termux):", "sys");
    out("  termux <cmd>     run a real command in Termux");
    out("  wakelock on|off  keep the CPU awake for servers");
  }

  function doSessions() {
    var progress = loadProgress();
    var done = LESSONS.filter(function (l) { return progress[l.id]; }).length;
    var fileCount = 0;
    (function count(node) {
      Object.keys(node).forEach(function (k) {
        if (isDir(node[k])) count(node[k]); else fileCount++;
      });
    })(fs);
    out("Your offline session", "sys");
    out("  Commands in history : " + history.length);
    out("  Lessons complete    : " + done + " / " + LESSONS.length);
    out("  Files in sandbox    : " + fileCount);
    out("  Saved servers       : " + loadServers().length);
    out("Everything is stored on THIS device and works with no internet.", "ok");
    out("Type 'reset' to wipe the sandbox filesystem back to fresh.", "sys");
  }

  /* ---------- More core commands (sandbox) ---------- */
  function resolveFile(name) {
    var dir = curDir();
    if (dir[name] === undefined) return { err: "No such file: " + name };
    if (isDir(dir[name])) return { err: name + ": Is a directory" };
    return { text: dir[name] };
  }

  function doCp(args) {
    var recursive = args.indexOf("-r") !== -1 || args.indexOf("-R") !== -1;
    var rest = args.filter(function (a) { return a[0] !== "-"; });
    if (rest.length < 2) { out("Usage: cp [-r] <src> <dest>", "err"); return; }
    var dir = curDir(), src = rest[0], dest = rest[1];
    if (dir[src] === undefined) { out("cp: " + src + ": No such file", "err"); return; }
    if (isDir(dir[src]) && !recursive) { out("cp: " + src + " is a directory (use -r)", "err"); return; }
    dir[dest] = JSON.parse(JSON.stringify(dir[src]));
    out("copied " + src + " -> " + dest, "ok");
  }

  function doMv(args) {
    var rest = args.filter(function (a) { return a[0] !== "-"; });
    if (rest.length < 2) { out("Usage: mv <src> <dest>", "err"); return; }
    var dir = curDir(), src = rest[0], dest = rest[1];
    if (dir[src] === undefined) { out("mv: " + src + ": No such file", "err"); return; }
    dir[dest] = dir[src];
    delete dir[src];
    out("moved " + src + " -> " + dest, "ok");
  }

  function doGrep(args, line) {
    var ci = args.indexOf("-i") !== -1;
    var inv = args.indexOf("-v") !== -1;
    var cnt = args.indexOf("-c") !== -1;
    var rest = args.filter(function (a) { return a[0] !== "-"; });
    if (rest.length < 2) { out("Usage: grep [-i] [-v] [-c] <text> <file>", "err"); return; }
    var pat = rest[0], fname = rest[1];
    var r = resolveFile(fname);
    if (r.err) { out("grep: " + r.err, "err"); return; }
    var p = ci ? pat.toLowerCase() : pat;
    var lines = r.text.replace(/\n$/, "").split("\n");
    var hits = lines.filter(function (ln) {
      var hay = ci ? ln.toLowerCase() : ln;
      var found = hay.indexOf(p) !== -1;
      return inv ? !found : found;
    });
    if (cnt) { out(String(hits.length)); return; }
    if (!hits.length) { out("(no matches)", "sys"); return; }
    hits.forEach(function (ln) {
      if (!ci && !inv) { out(ln.split(pat).join("[" + pat + "]")); }
      else out(ln);
    });
  }

  function doHeadTail(which, args) {
    var n = 10;
    var ni = args.indexOf("-n");
    if (ni !== -1 && args[ni + 1]) n = parseInt(args[ni + 1], 10) || 10;
    var rest = args.filter(function (a) { return a[0] !== "-" && !/^\d+$/.test(a); });
    var fname = rest[0];
    if (!fname) { out("Usage: " + which + " [-n N] <file>", "err"); return; }
    var r = resolveFile(fname);
    if (r.err) { out(which + ": " + r.err, "err"); return; }
    var lines = r.text.replace(/\n$/, "").split("\n");
    var pick = which === "head" ? lines.slice(0, n) : lines.slice(-n);
    pick.forEach(function (ln) { out(ln); });
  }

  function doWc(args) {
    var mode = args.filter(function (a) { return a[0] === "-"; })[0];
    var fname = args.filter(function (a) { return a[0] !== "-"; })[0];
    if (!fname) { out("Usage: wc [-l|-w|-c] <file>", "err"); return; }
    var r = resolveFile(fname);
    if (r.err) { out("wc: " + r.err, "err"); return; }
    var txt = r.text;
    var lc = txt.replace(/\n$/, "").split("\n").length;
    var wcount = txt.trim() ? txt.trim().split(/\s+/).length : 0;
    var cc = txt.length;
    if (mode === "-l") out(String(lc) + " " + fname);
    else if (mode === "-w") out(String(wcount) + " " + fname);
    else if (mode === "-c") out(String(cc) + " " + fname);
    else out("  " + lc + "  " + wcount + "  " + cc + "  " + fname);
  }

  function doSort(args) {
    var rev = args.indexOf("-r") !== -1;
    var num = args.indexOf("-n") !== -1;
    var fname = args.filter(function (a) { return a[0] !== "-"; })[0];
    if (!fname) { out("Usage: sort [-r] [-n] <file>", "err"); return; }
    var r = resolveFile(fname);
    if (r.err) { out("sort: " + r.err, "err"); return; }
    var lines = r.text.replace(/\n$/, "").split("\n");
    lines.sort(num ? function (a, b) { return parseFloat(a) - parseFloat(b); }
                    : function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    if (rev) lines.reverse();
    lines.forEach(function (ln) { out(ln); });
  }

  function doUniq(args) {
    var cnt = args.indexOf("-c") !== -1;
    var fname = args.filter(function (a) { return a[0] !== "-"; })[0];
    if (!fname) { out("Usage: uniq [-c] <file>   (tip: sort first)", "err"); return; }
    var r = resolveFile(fname);
    if (r.err) { out("uniq: " + r.err, "err"); return; }
    var lines = r.text.replace(/\n$/, "").split("\n");
    var prev = null, run = 0, outLines = [];
    lines.forEach(function (ln) {
      if (ln === prev) { run++; }
      else { if (prev !== null) outLines.push(cnt ? ("   " + run + " " + prev) : prev); prev = ln; run = 1; }
    });
    if (prev !== null) outLines.push(cnt ? ("   " + run + " " + prev) : prev);
    outLines.forEach(function (l) { out(l); });
  }

  function doFind(args) {
    var nameIdx = args.indexOf("-name");
    var pattern = nameIdx !== -1 ? args[nameIdx + 1] : null;
    var rx = pattern ? new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$") : null;
    var base = curDir();
    var results = [];
    (function walk(node, path) {
      Object.keys(node).forEach(function (k) {
        var p = path + "/" + k;
        if (!rx || rx.test(k)) results.push("." + p);
        if (isDir(node[k])) walk(node[k], p);
      });
    })(base, "");
    if (!results.length) { out("(nothing found)", "sys"); return; }
    results.forEach(function (r) { out(r); });
  }

  function doChmod(args) {
    var mode = args[0], fname = args[1];
    if (!mode || !fname) { out("Usage: chmod <mode> <file>   e.g. chmod +x run.sh  or  chmod 755 run.sh", "err"); return; }
    var dir = curDir();
    if (dir[fname] === undefined) { out("chmod: " + fname + ": No such file", "err"); return; }
    out("mode of '" + fname + "' changed to " + mode + " (simulated).", "ok");
    if (/x/.test(mode) || /7|5|1|3/.test(mode)) out("It's now executable \u2014 you could run it with  ./" + fname, "sys");
  }

  function doWhich(args) {
    var name = args[0];
    if (!name) { out("Usage: which <command>", "err"); return; }
    if (COMMANDS[name]) out("/usr/bin/" + name);
    else out(name + " not found", "err");
  }

  function escapeHTML(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---------- Lessons ---------- */
  var LESSONS = [
    { id: "nav", track: "Basics", title: "1 · Where am I?", steps: [
      { say: "Every shell has a \"current folder\". Type <b>pwd</b> to print it.", ok: function (c) { return c === "pwd"; }, hint: "Just type: pwd" },
      { say: "Now list what's in this folder. Type <b>ls</b>.", ok: function (c) { return c.split(" ")[0] === "ls"; }, hint: "Type: ls" },
      { say: "Hidden files start with a dot. Reveal them with <b>ls -a</b>.", ok: function (c) { return /^ls\s+-a/.test(c); }, hint: "Type: ls -a" }
    ]},
    { id: "move", track: "Navigation", title: "2 · Moving around", steps: [
      { say: "There's a folder called <b>projects</b>. Enter it: <b>cd projects</b>.", ok: function (c) { return /^cd\s+projects/.test(c); }, hint: "Type: cd projects" },
      { say: "Look inside with <b>ls</b>.", ok: function (c) { return c.split(" ")[0] === "ls"; }, hint: "Type: ls" },
      { say: "Go back up one level with <b>cd ..</b>", ok: function (c) { return /^cd\s+\.\./.test(c); }, hint: "Type: cd .." }
    ]},
    { id: "files", track: "Files", title: "3 · Reading & making files", steps: [
      { say: "Read the notes file: <b>cat notes.txt</b>.", ok: function (c) { return /^cat\s+notes\.txt/.test(c); }, hint: "Type: cat notes.txt" },
      { say: "Create an empty file: <b>touch todo.txt</b>.", ok: function (c) { return /^touch\s+todo\.txt/.test(c); }, hint: "Type: touch todo.txt" },
      { say: "Write into it: <b>echo hello &gt; todo.txt</b>.", ok: function (c) { return /^echo\s+.+>\s*todo\.txt/.test(c); }, hint: "Type: echo hello > todo.txt" },
      { say: "Check it worked: <b>cat todo.txt</b>.", ok: function (c) { return /^cat\s+todo\.txt/.test(c); }, hint: "Type: cat todo.txt" }
    ]},
    { id: "folders", track: "Files", title: "4 · Folders & cleanup", steps: [
      { say: "Make a folder: <b>mkdir sandbox</b>.", ok: function (c) { return /^mkdir\s+sandbox/.test(c); }, hint: "Type: mkdir sandbox" },
      { say: "See the whole tree: <b>tree</b>.", ok: function (c) { return c === "tree"; }, hint: "Type: tree" },
      { say: "Delete the folder: <b>rm -r sandbox</b>. (In real life, rm has no undo!)", ok: function (c) { return /^rm\s+-r\s+sandbox/.test(c); }, hint: "Type: rm -r sandbox" }
    ]},
    /* ===== BASICS ===== */
    { id: "orient", track: "Basics", title: "Getting oriented", steps: [
      { say: "Welcome! The blinking line is a <b>prompt</b> waiting for a command. Type <b>whoami</b> to see who you're logged in as.", ok: function (c) { return c === "whoami"; }, hint: "Type: whoami" },
      { say: "Every command can have a manual. Read one: <b>man ls</b>.", ok: function (c) { return /^man\s+ls/.test(c); }, hint: "Type: man ls" },
      { say: "Lost? <b>help</b> lists everything you can do here.", ok: function (c) { return c === "help"; }, hint: "Type: help" }
    ]},
    { id: "clear-hist", track: "Basics", title: "Clear & history", steps: [
      { say: "Run a couple of commands, then recall them. First type <b>date</b>.", ok: function (c) { return c === "date"; }, hint: "Type: date" },
      { say: "Now see everything you've typed: <b>history</b>.", ok: function (c) { return c === "history"; }, hint: "Type: history" },
      { say: "Tidy the screen with <b>clear</b>.", ok: function (c) { return c === "clear"; }, hint: "Type: clear" }
    ]},

    /* ===== FILES ===== */
    { id: "copy-move", track: "Files", title: "Copying & renaming", steps: [
      { say: "Copy notes.txt to a backup: <b>cp notes.txt notes.bak</b>.", ok: function (c) { return /^cp\s+notes\.txt\s+notes\.bak/.test(c); }, hint: "Type: cp notes.txt notes.bak" },
      { say: "Rename the backup with <b>mv</b>: <b>mv notes.bak backup.txt</b>.", ok: function (c) { return /^mv\s+notes\.bak\s+backup\.txt/.test(c); }, hint: "Type: mv notes.bak backup.txt" },
      { say: "Confirm both exist: <b>ls</b>.", ok: function (c) { return c.split(" ")[0] === "ls"; }, hint: "Type: ls" }
    ]},
    { id: "append", track: "Files", title: "> vs >> (write vs append)", steps: [
      { say: "<b>&gt;</b> overwrites. Write a fresh file: <b>echo one &gt; list.txt</b>.", ok: function (c) { return /echo\s+.+>\s*list\.txt/.test(c) && c.indexOf(">>") === -1; }, hint: "Type: echo one > list.txt" },
      { say: "<b>&gt;&gt;</b> adds to the end. Run: <b>echo two &gt;&gt; list.txt</b>.", ok: function (c) { return /echo\s+.+>>\s*list\.txt/.test(c); }, hint: "Type: echo two >> list.txt" },
      { say: "See both lines: <b>cat list.txt</b>.", ok: function (c) { return /^cat\s+list\.txt/.test(c); }, hint: "Type: cat list.txt" }
    ]},
    { id: "peek", track: "Files", title: "Peeking: head & tail", steps: [
      { say: "Show the first 3 lines of the log: <b>head -n 3 log.txt</b>.", ok: function (c) { return /^head/.test(c) && /log\.txt/.test(c); }, hint: "Type: head -n 3 log.txt" },
      { say: "Show the last 2 lines: <b>tail -n 2 log.txt</b>.", ok: function (c) { return /^tail/.test(c) && /log\.txt/.test(c); }, hint: "Type: tail -n 2 log.txt" }
    ]},
    { id: "find", track: "Files", title: "Finding files", steps: [
      { say: "List everything below here: <b>find .</b>.", ok: function (c) { return /^find\s+\./.test(c) && c.indexOf("-name") === -1; }, hint: "Type: find ." },
      { say: "Now only .txt files: <b>find . -name *.txt</b>.", ok: function (c) { return /^find/.test(c) && /-name/.test(c); }, hint: "Type: find . -name *.txt" }
    ]},

    /* ===== TEXT ===== */
    { id: "grep", track: "Text", title: "Searching inside files: grep", steps: [
      { say: "Find every ERROR line in the log: <b>grep ERROR log.txt</b>.", ok: function (c) { return /^grep\s+ERROR\s+log\.txt/.test(c); }, hint: "Type: grep ERROR log.txt" },
      { say: "Case doesn't match? Use <b>-i</b>: <b>grep -i error log.txt</b>.", ok: function (c) { return /^grep\s+-i\s+error\s+log\.txt/.test(c); }, hint: "Type: grep -i error log.txt" },
      { say: "Count matches instead of showing them: <b>grep -c ERROR log.txt</b>.", ok: function (c) { return /^grep\s+-c\s+ERROR\s+log\.txt/.test(c); }, hint: "Type: grep -c ERROR log.txt" }
    ]},
    { id: "count", track: "Text", title: "Counting: wc", steps: [
      { say: "How many lines in notes.txt? <b>wc -l notes.txt</b>.", ok: function (c) { return /^wc\s+-l\s+notes\.txt/.test(c); }, hint: "Type: wc -l notes.txt" },
      { say: "How many words? <b>wc -w notes.txt</b>.", ok: function (c) { return /^wc\s+-w\s+notes\.txt/.test(c); }, hint: "Type: wc -w notes.txt" }
    ]},
    { id: "sort-uniq", track: "Text", title: "Sort & de-duplicate", steps: [
      { say: "Sort the fruit list alphabetically: <b>sort fruits.txt</b>.", ok: function (c) { return /^sort\s+fruits\.txt/.test(c); }, hint: "Type: sort fruits.txt" },
      { say: "Reverse it: <b>sort -r fruits.txt</b>.", ok: function (c) { return /^sort\s+-r\s+fruits\.txt/.test(c); }, hint: "Type: sort -r fruits.txt" },
      { say: "Count each unique fruit: <b>uniq -c fruits.txt</b>. (real life: sort first!)", ok: function (c) { return /^uniq/.test(c) && /fruits\.txt/.test(c); }, hint: "Type: uniq -c fruits.txt" }
    ]},

    /* ===== PERMISSIONS ===== */
    { id: "perms", track: "Permissions", title: "Reading & changing permissions", steps: [
      { say: "See permissions with the long listing: <b>ls -l</b>.", ok: function (c) { return /^ls\s+-l/.test(c); }, hint: "Type: ls -l" },
      { say: "Make a script executable: <b>chmod +x app.js</b>.", ok: function (c) { return /^chmod\s+\+x/.test(c); }, hint: "Type: chmod +x app.js" },
      { say: "Or use numbers — owner all, others read+run: <b>chmod 755 app.js</b>.", ok: function (c) { return /^chmod\s+755/.test(c); }, hint: "Type: chmod 755 app.js" }
    ]},

    /* ===== NAVIGATION+ ===== */
    { id: "paths", track: "Navigation", title: "Absolute vs relative paths", steps: [
      { say: "Jump home from anywhere: <b>cd ~</b>.", ok: function (c) { return /^cd\s+~/.test(c) || c === "cd"; }, hint: "Type: cd ~" },
      { say: "Go two levels in one command: <b>cd projects/hello</b>.", ok: function (c) { return /^cd\s+projects\/hello/.test(c); }, hint: "Type: cd projects/hello" },
      { say: "Where are you now? <b>pwd</b>.", ok: function (c) { return c === "pwd"; }, hint: "Type: pwd" }
    ]},
    { id: "which", track: "Navigation", title: "Where does a command live?", steps: [
      { say: "Find the path of ls: <b>which ls</b>.", ok: function (c) { return /^which\s+ls/.test(c); }, hint: "Type: which ls" },
      { say: "Look up its manual too: <b>man grep</b>.", ok: function (c) { return /^man\s+grep/.test(c); }, hint: "Type: man grep" }
    ]},

    /* ===== PIPES & REAL SHELL (concept lessons) ===== */
    { id: "pipes", track: "Power tools", title: "Pipes: chaining commands", steps: [
      { say: "A <b>pipe</b> (|) feeds one command's output into the next. In a real shell: <code>cat log.txt | grep ERROR</code>. Here, run the pieces: <b>cat log.txt</b>.", ok: function (c) { return /^cat\s+log\.txt/.test(c); }, hint: "Type: cat log.txt" },
      { say: "Now the second half on its own: <b>grep ERROR log.txt</b>. On a real system the pipe joins them into one line.", ok: function (c) { return /^grep\s+ERROR\s+log\.txt/.test(c); }, hint: "Type: grep ERROR log.txt" }
    ]},
    { id: "vars", track: "Power tools", title: "Variables & echo", steps: [
      { say: "Shells store values in variables. Print one that already exists: <b>echo hello</b> (real shells: <code>echo $HOME</code>).", ok: function (c) { return /^echo\s+hello/.test(c); }, hint: "Type: echo hello" },
      { say: "You can save output to a file for later: <b>echo saved &gt; out.txt</b>.", ok: function (c) { return /echo\s+.+>\s*out\.txt/.test(c); }, hint: "Type: echo saved > out.txt" }
    ]}
,

    /* ---- Pentest track (simulated lab, offline) ---- */
    { id: "pt-roe", track: "Pentest", title: "Pentest 1 · Rules of engagement", steps: [
      { say: "Before ANY test you must know your limits. Type <b>scope</b> to read the rules of engagement.", ok: function (c) { return c === "scope"; }, hint: "Type: scope" },
      { say: "Legal, authorized, in-scope — always. Now see the whole attack methodology: type <b>pentest</b>.", ok: function (c) { return c === "pentest" || c === "security"; }, hint: "Type: pentest" }
    ]},
    { id: "pt-recon", track: "Pentest", title: "Pentest 2 · Recon — find the hosts", steps: [
      { say: "An attacker first maps the network. Discover live hosts: <b>nmap -sn 192.168.56.0/24</b>", ok: function (c) { return /^nmap\s+-sn\s+192\.168\.56\.0\/24/.test(c); }, hint: "Type: nmap -sn 192.168.56.0/24" },
      { say: "You found 4 hosts. Fingerprint the web box's services + versions: <b>nmap -sV 192.168.56.10</b>", ok: function (c) { return /^nmap\s+-sV\s+192\.168\.56\.10/.test(c); }, hint: "Type: nmap -sV 192.168.56.10" },
      { say: "Common scans miss ports. Scan ALL of them on the old box: <b>nmap -p- 192.168.56.101</b>", ok: function (c) { return /^nmap\s+-p-\s+192\.168\.56\.101/.test(c); }, hint: "Type: nmap -p- 192.168.56.101" }
    ]},
    { id: "pt-enum", track: "Pentest", title: "Pentest 3 · Enumerate the web target", steps: [
      { say: "Identify the web stack: <b>whatweb 192.168.56.10</b>", ok: function (c) { return /^whatweb\s+192\.168\.56\.10/.test(c); }, hint: "Type: whatweb 192.168.56.10" },
      { say: "Scan the web server for known issues: <b>nikto 192.168.56.10</b>", ok: function (c) { return /^nikto\s+192\.168\.56\.10/.test(c); }, hint: "Type: nikto 192.168.56.10" },
      { say: "Brute-force hidden pages/dirs: <b>gobuster dir -u 192.168.56.10</b>", ok: function (c) { return /^gobuster/.test(c); }, hint: "Type: gobuster dir -u 192.168.56.10" }
    ]},
    { id: "pt-exploit", track: "Pentest", title: "Pentest 4 · Find & confirm a flaw", steps: [
      { say: "Test the search parameter for SQL injection: <b>sqlmap 192.168.56.10</b>", ok: function (c) { return /^sqlmap\s+192\.168\.56\.10/.test(c); }, hint: "Type: sqlmap 192.168.56.10" },
      { say: "Confirmed vulnerable. In your real Kali lab you'd exploit it. First, re-read the limits: type <b>scope</b>.", ok: function (c) { return c === "scope"; }, hint: "Type: scope" },
      { say: "Now read the in-depth Field Guide below (tap a chapter) to learn HOW each attack works and how to STOP it.", ok: function (c) { return c === "learn" || c === "guide"; }, hint: "Type: learn" }
    ]},
    { id: "pt-vuln", track: "Pentest", title: "Pentest 5 · Vulnerability scanning", steps: [
      { say: "Run nmap's vuln scripts against the old box: <b>nmap --script vuln 192.168.56.101</b>", ok: function (c) { return /^nmap/.test(c) && /vuln/.test(c) && /56\.101/.test(c); }, hint: "Type: nmap --script vuln 192.168.56.101" },
      { say: "See that backdoored <b>vsftpd 2.3.4</b>? That's your way in. Confirm the version: <b>nmap -sV 192.168.56.101</b>", ok: function (c) { return /^nmap\s+-sV\s+192\.168\.56\.101/.test(c); }, hint: "Type: nmap -sV 192.168.56.101" }
    ]},
    { id: "pt-banner", track: "Pentest", title: "Pentest 6 · Banner grabbing with netcat", steps: [
      { say: "Grab the FTP banner by hand: <b>nc 192.168.56.101 21</b>", ok: function (c) { return /^nc\s+192\.168\.56\.101\s+21/.test(c); }, hint: "Type: nc 192.168.56.101 21" },
      { say: "Now the SSH banner: <b>nc 192.168.56.20 22</b>", ok: function (c) { return /^nc\s+192\.168\.56\.20\s+22/.test(c); }, hint: "Type: nc 192.168.56.20 22" }
    ]},
    { id: "pt-smb", track: "Pentest", title: "Pentest 7 · SMB enumeration", steps: [
      { say: "Enumerate SMB shares on the file box: <b>enum4linux 192.168.56.20</b>", ok: function (c) { return /^enum4linux\s+192\.168\.56\.20/.test(c); }, hint: "Type: enum4linux 192.168.56.20" },
      { say: "List the shares directly too: <b>smbclient -L 192.168.56.20</b>", ok: function (c) { return /^smbclient/.test(c) && /56\.20/.test(c); }, hint: "Type: smbclient -L 192.168.56.20" }
    ]},
    { id: "pt-brute", track: "Pentest", title: "Pentest 8 · Password brute-forcing", steps: [
      { say: "Brute-force SSH on the file box: <b>hydra 192.168.56.20 ssh</b>", ok: function (c) { return /^hydra/.test(c) && /56\.20/.test(c); }, hint: "Type: hydra 192.168.56.20 ssh" },
      { say: "You found weak creds. Note WHY it worked — then re-read the rules: <b>scope</b>", ok: function (c) { return c === "scope"; }, hint: "Type: scope" }
    ]},
    { id: "pt-ftp", track: "Pentest", title: "Pentest 9 · Anonymous FTP & risky versions", steps: [
      { say: "Connect to FTP on the old box: <b>ftp 192.168.56.101</b>", ok: function (c) { return /^ftp\s+192\.168\.56\.101/.test(c); }, hint: "Type: ftp 192.168.56.101" },
      { say: "Anonymous login + a backdoored version! Find the exploit: <b>searchsploit vsftpd 2.3.4</b>", ok: function (c) { return /^searchsploit/.test(c) && /vsftpd/.test(c); }, hint: "Type: searchsploit vsftpd 2.3.4" }
    ]},
    { id: "pt-exploit2", track: "Pentest", title: "Pentest 10 · Exploit with Metasploit", steps: [
      { say: "You have a matching exploit. Walk the Metasploit flow: type <b>msfconsole</b>", ok: function (c) { return /^msf/.test(c); }, hint: "Type: msfconsole" },
      { say: "That's initial access. Study how you'd DETECT it — open the Field Guide: <b>learn</b>", ok: function (c) { return c === "learn"; }, hint: "Type: learn" }
    ]},
    { id: "pt-crack", track: "Pentest", title: "Pentest 11 · Cracking password hashes", steps: [
      { say: "You looted a password hash. Crack it offline: <b>hashcat -m 0 hashes.txt rockyou.txt</b>", ok: function (c) { return /^hashcat/.test(c); }, hint: "Type: hashcat -m 0 hashes.txt rockyou.txt" },
      { say: "Instant — because it was unsalted MD5. Try John too: <b>john hashes.txt</b>", ok: function (c) { return /^john/.test(c); }, hint: "Type: john hashes.txt" }
    ]},
    { id: "pt-web2", track: "Pentest", title: "Pentest 12 · Web app deep dive", steps: [
      { say: "Fingerprint the web target: <b>whatweb 192.168.56.10</b>", ok: function (c) { return /^whatweb\s+192\.168\.56\.10/.test(c); }, hint: "Type: whatweb 192.168.56.10" },
      { say: "Brute-force hidden paths: <b>gobuster dir -u 192.168.56.10</b>", ok: function (c) { return /^gobuster/.test(c); }, hint: "Type: gobuster dir -u 192.168.56.10" },
      { say: "Test for SQL injection: <b>sqlmap 192.168.56.10</b>", ok: function (c) { return /^sqlmap\s+192\.168\.56\.10/.test(c); }, hint: "Type: sqlmap 192.168.56.10" }
    ]},
    { id: "pt-blue", track: "Pentest", title: "Pentest 13 · Blue team — detect it", steps: [
      { say: "Every attack above leaves traces. Open the Field Guide to chapter 8: type <b>learn</b>", ok: function (c) { return c === "learn"; }, hint: "Type: learn" },
      { say: "Read '8 · Blue Team: Detection & Response', then come back. Type <b>pentest</b> to review the whole chain.", ok: function (c) { return c === "pentest" || c === "security"; }, hint: "Type: pentest" }
    ]},
    { id: "pt-report", track: "Pentest", title: "Pentest 14 · Report & remediate", steps: [
      { say: "A finding isn't done until it's written up. Open the guide: <b>learn</b> and read '9 · Reporting'.", ok: function (c) { return c === "learn"; }, hint: "Type: learn" },
      { say: "Final check — confirm you stayed in scope the whole time: <b>scope</b>", ok: function (c) { return c === "scope"; }, hint: "Type: scope" }
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
        markLessonComplete(lesson.l.id);
        outHTML("🎉 Lesson complete: <b>" + lesson.l.title + "</b>. Progress saved. Try the next one in the Learn tab!", "lesson");
        lesson.active = false;
      } else lessonPrompt();
    } else {
      out("Not quite. Hint: " + st.hint, "sys");
    }
  }
  var TRACK_ORDER = ["Basics", "Navigation", "Files", "Text", "Permissions", "Power tools", "Pentest"];
  var TRACK_META = {
    "Basics":      { icon: "👣", blurb: "First steps in the shell" },
    "Navigation":  { icon: "🧭", blurb: "Move around the filesystem" },
    "Files":       { icon: "📄", blurb: "Create, copy, move, find" },
    "Text":        { icon: "🔍", blurb: "Search, count, sort text" },
    "Permissions": { icon: "🔐", blurb: "Who can read/write/run" },
    "Power tools": { icon: "⚡", blurb: "Pipes, variables, chaining" },
    "Pentest":     { icon: "🛡️", blurb: "Ethical hacking methodology" }
  };

  function progressRing(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    var C = 2 * Math.PI * 26;
    var off = C * (1 - pct / 100);
    return "<div class='ring-wrap'><svg class='ring' viewBox='0 0 60 60'>" +
      "<circle class='ring-bg' cx='30' cy='30' r='26'></circle>" +
      "<circle class='ring-fg' cx='30' cy='30' r='26' stroke-dasharray='" + C.toFixed(1) +
      "' stroke-dashoffset='" + off.toFixed(1) + "'></circle></svg>" +
      "<div class='ring-pct'>" + pct + "%</div></div>";
  }

  function renderLessons() {
    var box = document.getElementById("lessonList");
    box.innerHTML = "";
    var progress = loadProgress();
    var done = LESSONS.filter(function (l) { return progress[l.id]; }).length;

    var hero = document.createElement("div");
    hero.className = "progress-hero";
    hero.innerHTML = progressRing(done, LESSONS.length) +
      "<div class='hero-txt'><div class='hero-num'>" + done + " / " + LESSONS.length + "</div>" +
      "<div class='hero-sub'>lessons complete · saved offline on this device</div></div>";
    box.appendChild(hero);

    var groups = {};
    LESSONS.forEach(function (l) { var t = l.track || "Other"; (groups[t] = groups[t] || []).push(l); });
    var order = TRACK_ORDER.filter(function (t) { return groups[t]; });
    Object.keys(groups).forEach(function (t) { if (order.indexOf(t) === -1) order.push(t); });

    order.forEach(function (t) {
      var items = groups[t];
      var tdone = items.filter(function (l) { return progress[l.id]; }).length;
      var meta = TRACK_META[t] || { icon: "📘", blurb: "" };

      var sect = document.createElement("div");
      sect.className = "track" + (tdone === items.length ? " track-done" : "");

      var head = document.createElement("button");
      head.className = "track-head"; head.type = "button";
      head.innerHTML = "<span class='track-ic'>" + meta.icon + "</span>" +
        "<span class='track-name'>" + t + "<small>" + meta.blurb + "</small></span>" +
        "<span class='track-count'>" + tdone + "/" + items.length + "</span>" +
        "<span class='track-chev'>›</span>";
      var body = document.createElement("div"); body.className = "track-body";
      head.onclick = function () { sect.classList.toggle("open"); };

      items.forEach(function (l) {
        var complete = !!progress[l.id];
        var row = document.createElement("div");
        row.className = "lesson-row" + (complete ? " done" : "");
        row.innerHTML = "<span class='lesson-check'>" + (complete ? "✓" : "○") + "</span>" +
          "<span class='lesson-info'><b>" + l.title + "</b><small>" + l.steps.length + " steps</small></span>";
        var b = document.createElement("button");
        b.className = "lesson-go"; b.type = "button";
        b.textContent = complete ? "↺" : "Start";
        b.onclick = function (e) { e.stopPropagation(); startLesson(l.id); };
        row.appendChild(b); body.appendChild(row);
      });

      sect.appendChild(head); sect.appendChild(body);
      if (tdone < items.length && !document.querySelector(".track.open")) sect.classList.add("open");
      box.appendChild(sect);
    });

    renderGuide(box);
    renderAgentSkills(box);
  }

  /* ---------- In-depth offline Field Guide (offense + how to defend) ----------
   * Career-oriented reference. Each chapter explains what attackers actually do,
   * the real tools/commands, and — because the goal is to STOP them — the
   * defender's countermeasures and detection for every technique. */
  var GUIDE = [
    { id: "g-ethics", title: "0 · Ethics, Law & Authorization", body:
      "<p><b>The one rule that keeps this a career and not a crime:</b> only ever touch systems you own or have <b>explicit written permission</b> to test.</p>" +
      "<ul><li><b>Scope</b> — the exact IPs/domains/hours you're cleared for. Straying outside it is illegal even mid-engagement.</li>" +
      "<li><b>Rules of Engagement (ROE)</b> — what's allowed: social engineering? DoS? data exfiltration? Get it in writing.</li>" +
      "<li><b>Law</b> — unauthorized access is criminal (e.g. the US CFAA, UK Computer Misuse Act, and equivalents worldwide). 'I was just testing' is not a defense.</li>" +
      "<li><b>Engagement types</b> — black-box (no info), grey-box (some), white-box (full access + source). Red team = stealthy adversary emulation; pentest = find as many holes as possible.</li></ul>" +
      "<p><b>Get authorized experience legally:</b> HackTheBox, TryHackMe, PortSwigger Web Security Academy, PicoCTF, OverTheWire, VulnHub, and your own home lab.</p>" +
      "<p class='gtag'>🛡️ Defender's view: know your own authorization boundaries too — a signed scope protects <i>you</i>. Blue teams should log and alert on any scanning that appears outside sanctioned windows.</p>" },

    { id: "g-method", title: "1 · The Attack Lifecycle", body:
      "<p>Real intrusions follow a repeatable chain. Learn it and you can predict — and interrupt — an attacker at every stage.</p>" +
      "<p><b>Lockheed Martin Cyber Kill Chain:</b> Recon → Weaponize → Deliver → Exploit → Install → Command &amp; Control (C2) → Actions on Objectives.</p>" +
      "<p><b>Pentest phases (PTES):</b> Pre-engagement → Intelligence gathering → Threat modeling → Vulnerability analysis → Exploitation → Post-exploitation → Reporting.</p>" +
      "<p><b>MITRE ATT&amp;CK</b> is the industry map of real-world attacker <i>tactics</i> (the why: Initial Access, Execution, Persistence, Privilege Escalation, Defense Evasion, Credential Access, Discovery, Lateral Movement, Collection, Exfiltration, Impact) and <i>techniques</i> (the how, each a T-number like T1190). Memorize this taxonomy — every SOC and detection tool speaks ATT&amp;CK.</p>" +
      "<p class='gtag'>🛡️ Defender's view: map your logging/detection coverage to ATT&amp;CK. Every technique the attacker uses is an opportunity to detect them — the earlier in the chain you break it, the cheaper the incident.</p>" },

    { id: "g-recon", title: "2 · Reconnaissance", body:
      "<p>Gathering information before touching the target.</p>" +
      "<p><b>Passive</b> (no packets to target): WHOIS, DNS records, Google dorking, Shodan/Censys, certificate transparency logs, LinkedIn/GitHub leaks, <code>theHarvester</code>, <code>amass</code>. Finds domains, employees, tech stack, exposed services.</p>" +
      "<p><b>Active</b> (touching the target): DNS zone transfers, ping sweeps, port scans (next chapter).</p>" +
      "<p>Example: <code>whatweb https://target</code>, <code>amass enum -d target.com</code>, <code>theHarvester -d target.com -b all</code>.</p>" +
      "<p class='gtag'>🛡️ Defender's view: shrink your attack surface — remove stale DNS records, scrub metadata, keep secrets out of GitHub, and monitor certificate-transparency + brand mentions. You can't stop passive recon, but you can starve it.</p>" },

    { id: "g-scan", title: "3 · Scanning & Enumeration", body:
      "<p>Turning 'there's a host' into 'here's exactly what's running.' This is where most footholds are found.</p>" +
      "<p><b>nmap</b> is the core tool:</p>" +
      "<ul><li><code>nmap -sn 10.0.0.0/24</code> — host discovery (who's alive)</li>" +
      "<li><code>nmap -sV -p- 10.0.0.5</code> — every port + service versions</li>" +
      "<li><code>nmap -A</code> — OS detection, default scripts, traceroute</li>" +
      "<li><code>nmap --script vuln 10.0.0.5</code> — NSE vuln checks</li></ul>" +
      "<p><b>Service enumeration</b> is where the real work is: SMB (<code>enum4linux</code>, <code>smbclient</code>), web (dir brute-forcing with <code>gobuster</code>/<code>feroxbuster</code>), SNMP, LDAP, databases. Version numbers → searchable CVEs.</p>" +
      "<p class='gtag'>🛡️ Defender's view: close unused ports, patch to kill version-based CVEs, put an IDS/IPS (Suricata, Zeek) on the wire — mass port scans and NSE scripts are noisy and very detectable. Alert on them.</p>" },

    { id: "g-web", title: "4 · Web Application Attacks (OWASP Top 10)", body:
      "<p>Web apps are the #1 attack surface. Know each class cold:</p>" +
      "<ul><li><b>Injection (SQLi/command)</b> — untrusted input hits an interpreter. <code>sqlmap -u 'url?id=1' --batch --dbs</code>. <i>Fix:</i> parameterized queries / prepared statements.</li>" +
      "<li><b>Broken Access Control</b> — accessing data/actions you shouldn't (IDOR: change <code>?id=1</code> to <code>?id=2</code>). <i>Fix:</i> server-side authorization on every request.</li>" +
      "<li><b>XSS</b> — inject JS that runs in a victim's browser (steal sessions). <i>Fix:</i> output-encode, CSP.</li>" +
      "<li><b>Auth failures</b> — weak passwords, no lockout, guessable tokens. <i>Fix:</i> MFA, rate-limit, strong session handling.</li>" +
      "<li><b>SSRF</b> — make the server request internal resources. <i>Fix:</i> allow-list outbound, block metadata endpoints.</li>" +
      "<li><b>Security misconfig / vulnerable components</b> — default creds, verbose errors, outdated libs. <i>Fix:</i> harden, patch, remove defaults.</li></ul>" +
      "<p>Tooling: <b>Burp Suite</b> (the intercepting proxy every web tester lives in), <code>nikto</code>, <code>ffuf</code>, and OWASP <b>ZAP</b>. Practice on <b>Juice Shop</b> / <b>DVWA</b>.</p>" +
      "<p class='gtag'>🛡️ Defender's view: secure-code reviews, input validation + output encoding, a WAF, dependency scanning (SCA), and logging every auth + access-control decision. Most of the Top 10 dies with parameterized queries and server-side authz.</p>" },

    { id: "g-creds", title: "5 · Password & Credential Attacks", body:
      "<p>Stolen credentials are behind most breaches.</p>" +
      "<ul><li><b>Online brute/spray</b> — guess against a live login. <code>hydra -l admin -P rockyou.txt ssh://10.0.0.5</code>. Password <i>spraying</i> tries one common password across many users to dodge lockouts.</li>" +
      "<li><b>Offline cracking</b> — you have the hashes; crack them fast on GPU. <code>hashcat -m 0 hashes.txt rockyou.txt</code> (mode = hash type).</li>" +
      "<li><b>Credential stuffing</b> — reuse creds leaked from other breaches.</li>" +
      "<li><b>Hashing matters</b> — MD5/SHA1 crack instantly; bcrypt/argon2 with salt are slow to crack by design.</li></ul>" +
      "<p class='gtag'>🛡️ Defender's view: enforce <b>MFA everywhere</b> (kills the vast majority of these), strong salted hashing (argon2/bcrypt), account lockout + rate limiting, ban breached passwords (HaveIBeenPwned API), and alert on spray patterns (many users, one password, short window).</p>" },

    { id: "g-exploit", title: "6 · Exploitation & Metasploit", body:
      "<p>Turning a vulnerability into access.</p>" +
      "<p><b>Metasploit</b> workflow:</p>" +
      "<ul><li><code>msfconsole</code> → <code>search vsftpd 2.3.4</code></li>" +
      "<li><code>use exploit/...</code> → <code>show options</code></li>" +
      "<li><code>set RHOSTS 10.0.0.5</code> / <code>set LHOST &lt;you&gt;</code></li>" +
      "<li><code>set PAYLOAD ...</code> → <code>exploit</code></li></ul>" +
      "<p><b>Payloads</b>: bind shell (attacker connects in) vs reverse shell (target connects out, beats firewalls). <b>Meterpreter</b> is Metasploit's feature-rich in-memory payload. Public exploits live in Exploit-DB / <code>searchsploit</code>, indexed by CVE.</p>" +
      "<p class='gtag'>🛡️ Defender's view: <b>patch management</b> is the single biggest win — most exploits target known, fixed CVEs. Add EDR to catch payloads/Meterpreter in memory, egress filtering to block reverse shells, and network segmentation to limit blast radius.</p>" },

    { id: "g-post", title: "7 · Post-Exploitation: Privesc, Lateral Movement, Persistence", body:
      "<p>A foothold is the beginning, not the end.</p>" +
      "<ul><li><b>Privilege escalation</b> — user → root/admin via kernel exploits, misconfigured sudo, SUID binaries, weak service perms (Linux: <code>linpeas</code>; Windows: <code>winPEAS</code>, token abuse).</li>" +
      "<li><b>Credential harvesting</b> — dump memory/registry for hashes &amp; tokens (Mimikatz on Windows), then <b>pass-the-hash</b>.</li>" +
      "<li><b>Lateral movement</b> — hop to other hosts with reused creds (PsExec, WinRM, SSH keys).</li>" +
      "<li><b>Persistence</b> — survive reboots: cron jobs, services, scheduled tasks, SSH keys, run keys.</li>" +
      "<li><b>Defense evasion</b> — clearing logs, living-off-the-land (using built-in tools). <i>Studying this is how you learn to detect it.</i></li></ul>" +
      "<p class='gtag'>🛡️ Defender's view: least privilege, remove local admin, segment the network, unique local admin passwords (LAPS), and centralize + protect logs. Watch for Mimikatz behavior, new services/scheduled tasks, and impossible-travel logins — classic lateral-movement tells.</p>" },

    { id: "g-blue", title: "8 · Blue Team: Detection & Response (your career)", body:
      "<p>This is where a defender lives. Every attacker action above leaves evidence — your job is to see it and act.</p>" +
      "<ul><li><b>Logging</b> — endpoints (Sysmon), auth logs, DNS, proxy, cloud. You can't detect what you don't log.</li>" +
      "<li><b>SIEM</b> — Splunk, Elastic/ELK, Microsoft Sentinel, Wazuh: aggregate logs, write detection rules (often as Sigma rules), alert.</li>" +
      "<li><b>Detection engineering</b> — map coverage to ATT&amp;CK; write &amp; tune detections; reduce false positives.</li>" +
      "<li><b>Threat hunting</b> — proactively search for attackers who slipped past alerts.</li>" +
      "<li><b>Incident Response (IR)</b> — the PICERL cycle: Preparation, Identification, Containment, Eradication, Recovery, Lessons learned.</li>" +
      "<li><b>Adversary emulation</b> — run Atomic Red Team / Caldera against your lab to test whether your detections actually fire.</li></ul>" +
      "<p class='gtag'>🛡️ Career path: SOC Analyst → Detection Engineer / Incident Responder → Threat Hunter. Certs to aim at: Security+ (foundation), BTL1/CySA+ (blue team), then GCIH/GCIA. Learn one SIEM deeply and one scripting language (Python).</p>" },

    { id: "g-report", title: "9 · Reporting & Remediation", body:
      "<p>The deliverable that makes a pentest valuable — and the bridge to defense.</p>" +
      "<ul><li><b>Executive summary</b> — risk in business terms for leadership.</li>" +
      "<li><b>Findings</b> — each with: description, evidence/steps to reproduce, impact, <b>CVSS</b> severity score, and a concrete <b>remediation</b>.</li>" +
      "<li><b>Prioritize</b> by risk (likelihood × impact), not by how cool the exploit was.</li>" +
      "<li><b>Retest</b> — verify fixes actually closed the hole.</li></ul>" +
      "<p class='gtag'>🛡️ Defender's view: turn each finding into a permanent control + a detection rule so the same class of bug is caught automatically next time. A finding fixed once is good; a finding that can never recur silently is better.</p>" }
  ];

  function renderGuide(box) {
    var hdr = document.createElement("div");
    hdr.className = "section-title";
    hdr.style.marginTop = "18px";
    hdr.textContent = "Field guide — offense & defense (offline, in depth)";
    box.appendChild(hdr);

    GUIDE.forEach(function (ch) {
      var card = document.createElement("div");
      card.className = "card";
      var head = document.createElement("h3");
      head.textContent = ch.title;
      head.style.cursor = "pointer";
      var body = document.createElement("div");
      body.className = "guide-body";
      body.style.display = "none";
      body.innerHTML = ch.body;
      var toggle = document.createElement("button");
      toggle.className = "btn"; toggle.type = "button"; toggle.textContent = "Read ▾";
      toggle.onclick = function () {
        var open = body.style.display === "none";
        body.style.display = open ? "block" : "none";
        toggle.textContent = open ? "Hide ▴" : "Read ▾";
      };
      head.onclick = toggle.onclick;
      var row = document.createElement("div"); row.className = "btnrow"; row.appendChild(toggle);
      card.appendChild(head); card.appendChild(row); card.appendChild(body);
      box.appendChild(card);
    });
  }

  /* ---------- Agent Skills — offline curriculum for building WITH an AI ----------
   * How coding agents (like Kortana) actually work, and the skills to drive one:
   * specs, the act/observe loop, tools, debugging, git, testing, and how she
   * grows without degrading. Fully offline, in depth. */
  var SKILLS = [
    { title: "1 · How an AI coding agent actually works", body:
      "<p>An 'agent' isn't magic — it's a loop around a language model:</p>" +
      "<ol><li><b>Perceive</b> — it reads your request plus context (files, errors, history).</li>" +
      "<li><b>Plan</b> — it decides the next single step.</li>" +
      "<li><b>Act</b> — it calls a <i>tool</i> (run a command, search the web, edit a file).</li>" +
      "<li><b>Observe</b> — it reads the result of that action.</li>" +
      "<li><b>Repeat</b> — until the goal is met.</li></ol>" +
      "<p>The model itself only predicts text. What makes it an <i>agent</i> is that its text can trigger tools, and the tool results feed back in. Kortana runs exactly this loop in Terminus (<code>runToolLoop</code>).</p>" +
      "<p class='gtag'>Key idea: an agent is a <b>loop + tools + memory</b> wrapped around a model — not the model alone.</p>" },

    { title: "2 · Context is everything (and it's finite)", body:
      "<p>The model can only 'see' what's in its <b>context window</b> — a fixed budget of tokens (roughly ¾ of a word each). Everything competes for that space: your message, the files, the error, the history.</p>" +
      "<ul><li>Give the <b>relevant</b> slice, not the whole repo. Paste the failing function, not the entire file.</li>" +
      "<li>Show the <b>actual error text</b>, not 'it broke'.</li>" +
      "<li>Old, irrelevant history crowds out room to think — start fresh for a new task.</li></ul>" +
      "<p class='gtag'>A focused 20-line context beats a vague 2,000-line one every time.</p>" },

    { title: "3 · Write a spec the agent can nail", body:
      "<p>A weak ask gets a weak result. A good spec has four parts:</p>" +
      "<ul><li><b>Goal</b> — what should be true when it's done.</li>" +
      "<li><b>Constraints</b> — language, style, what NOT to touch.</li>" +
      "<li><b>Acceptance check</b> — how you'll both know it worked (a command that passes, an output that appears).</li>" +
      "<li><b>Example</b> — one concrete input → expected output.</li></ul>" +
      "<p>Compare: <i>'make it faster'</i> vs <i>'cut the /search response under 200ms for a 10k-row table; keep the JSON shape; verify with the timing log'.</i></p>" +
      "<p class='gtag'>The acceptance check is the most-skipped and most-valuable part. Always include it.</p>" },

    { title: "4 · The plan → act → observe loop (your loop too)", body:
      "<p>The single biggest skill: <b>one small change at a time, then verify.</b></p>" +
      "<ul><li>Make the smallest change that could work.</li>" +
      "<li>Run it. Read what actually happened.</li>" +
      "<li>Only then decide the next step.</li></ul>" +
      "<p>Batching ten changes and running once means you can't tell which one broke it. Agents that 'go quiet for a long time' are usually skipping the observe step — don't let yours (or you) do that.</p>" +
      "<p class='gtag'>Small step, verify, repeat. This is how both you and Kortana avoid digging holes.</p>" },

    { title: "5 · Tools & function calling", body:
      "<p>A tool is a named action the agent can request, with arguments, and get a result back. Kortana's tools include <code>web_search</code>, <code>web_fetch</code>, an allowlisted read-only <code>shell</code>, and file read.</p>" +
      "<p>She calls one by emitting a line like:</p>" +
      "<div class='cmd-preview'>TOOL_CALL: web_search {\"query\":\"nginx 502 after deploy\"}</div>" +
      "<p>Terminus runs it, feeds the result back, and she continues. This is how she can <b>look things up she doesn't know</b> instead of guessing.</p>" +
      "<p class='gtag'>Tools turn a model that only knows its training data into one that can act on today's world.</p>" },

    { title: "6 · Read errors like a detective", body:
      "<p>Most debugging is reading. The error already tells you most of it.</p>" +
      "<ul><li><b>Read the LAST error first</b> — the bottom of a stack trace is usually where it actually failed.</li>" +
      "<li><b>Reproduce it</b> reliably before changing anything — a bug you can't trigger, you can't fix.</li>" +
      "<li><b>Bisect</b> — comment half out, or <code>git bisect</code>, to find where it starts.</li>" +
      "<li><b>Change one thing</b>, re-run, repeat.</li></ul>" +
      "<p>When you ask Kortana for help, paste the <i>real</i> error and what you already tried — that skips ten guesses.</p>" +
      "<p class='gtag'>The error message is a gift, not noise. Read it slowly.</p>" },

    { title: "7 · Git without fear", body:
      "<p>Git is your undo button — learn just enough to never lose work.</p>" +
      "<ul><li><code>git status</code> — what changed (run it constantly).</li>" +
      "<li><code>git diff</code> — exactly what changed, line by line. <b>Review before you commit.</b></li>" +
      "<li><code>git add -p</code> — stage changes hunk by hunk so commits stay small and meaningful.</li>" +
      "<li><code>git commit -m \"why, not just what\"</code>.</li>" +
      "<li><code>git checkout -b feature/x</code> — never experiment on <code>main</code>.</li>" +
      "<li>Made a mess? <code>git restore &lt;file&gt;</code> or <code>git reset --hard</code> (loses uncommitted work — know that).</li></ul>" +
      "<p class='gtag'>Commit small and often; a good history is a series of safe checkpoints you can walk back to.</p>" },

    { title: "8 · Testing & verification — trust nothing unchecked", body:
      "<p>'It looks right' is not 'it works'. Before you believe any change — yours or an agent's — <b>have a check that proves it.</b></p>" +
      "<ul><li>A test, a curl that returns 200, an output that matches, a number that dropped.</li>" +
      "<li>Write (or state) the check <i>before</i> the change, so success is defined up front.</li>" +
      "<li>Re-run the check after every step — that's the 'observe' in the loop.</li></ul>" +
      "<p>Agents hallucinate confident wrong answers; a concrete check is what catches them. This is the discipline that separates shipping from hoping.</p>" +
      "<p class='gtag'>No check, no trust. Define 'done' as something you can run.</p>" },

    { title: "9 · Prompting Kortana (your coding companion)", body:
      "<p>She's most useful when you give her what she needs to think:</p>" +
      "<ul><li><b>Context</b> — the file/function, not a paraphrase.</li>" +
      "<li><b>The error</b> — verbatim.</li>" +
      "<li><b>What you tried</b> — so she doesn't repeat it.</li>" +
      "<li><b>What you want</b> — and whether you want the answer, or to be <i>coached</i> to it.</li></ul>" +
      "<p>Turn on <b>Coach mode</b> (Kortana tab → 'watch &amp; coach as I work') and she'll watch your terminal and nudge you as you go — a tip, a warning, the next step — instead of only answering when asked.</p>" +
      "<p class='gtag'>Ask for the next step, not the whole solution, when you're trying to learn. You'll remember it.</p>" },

    { title: "10 · How she grows without degrading", body:
      "<p>You can't retrain a model on a phone — and repeatedly fine-tuning on your own chats actually makes models <i>worse</i> (they drift and forget). So real, non-degrading growth doesn't touch the weights at all. Instead:</p>" +
      "<ul><li><b>Memory</b> — she saves what she learns about you and your projects, and reloads it as context.</li>" +
      "<li><b>Skills</b> — reusable procedures she writes down (in <code>.agent-memory/skills</code>) and follows later.</li>" +
      "<li><b>Web search</b> — she looks up what she doesn't know, on demand.</li>" +
      "<li><b>Better model, same her</b> — pull a stronger Ollama coding model and she uses it automatically; her identity and memory are unchanged.</li></ul>" +
      "<p>That's the honest version of a 'recursive learning loop': she accumulates <i>knowledge and code she keeps</i>, which never degrades, rather than chasing weight updates that do.</p>" +
      "<p class='gtag'>Growth = accumulated memory + skills + tools + a better model underneath. Not fine-tuning on yourself.</p>" },

    { title: "11 · Safety, scope & secrets", body:
      "<p>An agent that can run commands and act on your phone needs guardrails — these are yours to keep:</p>" +
      "<ul><li><b>Least privilege</b> — give her the narrowest access that does the job (her shell tool is read-only + allowlisted for exactly this reason).</li>" +
      "<li><b>Review before running</b> anything destructive; a confident suggestion can still be wrong.</li>" +
      "<li><b>Secrets never in code</b> — API keys go in <code>.env</code> / secret stores, never committed. (Terminus keeps keys in <code>server/.env</code>.)</li>" +
      "<li><b>Scope</b> — the accessibility service that lets her see your screen is off until you enable it, and one tap revokes it. That's the trust boundary; you hold it.</li></ul>" +
      "<p class='gtag'>Power + guardrails, not power alone. You stay the owner of what she's allowed to touch.</p>" }
  ];

  function renderAgentSkills(box) {
    var hdr = document.createElement("div");
    hdr.className = "section-title";
    hdr.style.marginTop = "18px";
    hdr.textContent = "Agent Skills — building WITH an AI (offline, in depth)";
    box.appendChild(hdr);

    SKILLS.forEach(function (ch) {
      var card = document.createElement("div");
      card.className = "card";
      var head = document.createElement("h3");
      head.textContent = ch.title;
      head.style.cursor = "pointer";
      var body = document.createElement("div");
      body.className = "guide-body";
      body.style.display = "none";
      body.innerHTML = ch.body;
      var toggle = document.createElement("button");
      toggle.className = "btn"; toggle.type = "button"; toggle.textContent = "Read ▾";
      toggle.onclick = function () {
        var open = body.style.display === "none";
        body.style.display = open ? "block" : "none";
        toggle.textContent = open ? "Hide ▴" : "Read ▾";
      };
      head.onclick = toggle.onclick;
      var row = document.createElement("div"); row.className = "btnrow"; row.appendChild(toggle);
      card.appendChild(head); card.appendChild(row); card.appendChild(body);
      box.appendChild(card);
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

  /* ---------- Kortana — chat with her local Terminus brain ----------
   * BashMeSilly is her front-end: this tab talks to Terminus (POST /api/brain)
   * running on the phone (default http://127.0.0.1:3300), and can start/stop
   * her brains (Ollama) + server through the existing Termux bridge. The HTTP
   * goes through the native bridge so the localhost/cleartext + WebView
   * mixed-content limits don't apply. Chat history is saved offline. */
  var KURL_KEY = "terminalapi.kortana.url";
  var KCHAT_KEY = "terminalapi.kortana.chat";
  var KMODEL_KEY = "terminalapi.kortana.model";
  var KCOACH_KEY = "terminalapi.kortana.coach";   // auto-coach toggle
  var KKEY_KEY = "terminalapi.kortana.key";       // TERMINUS_API_KEY for the hosted brain
  var K_DEFAULT_URL = "https://k3-6pwr.onrender.com";  // her always-on Render brain (off the phone)
  var K_START = "bash ~/k3/server/deploy/termux-start.sh";
  var kLastCoach = 0;   // debounce timestamp for auto-coach

  function kortanaUrl() { return (localStorage.getItem(KURL_KEY) || K_DEFAULT_URL).replace(/\/+$/, ""); }
  function kortanaKey() { return (localStorage.getItem(KKEY_KEY) || "").trim(); }
  function loadKChat() { return readJSON(KCHAT_KEY, []); }
  function saveKChat(a) { saveJSON(KCHAT_KEY, a.slice(-100)); }

  /* Async bridge HTTP. Resolves to an envelope {ok,status,body} | {ok:false,error}.
   * Falls back to real fetch() in a plain browser so the tab is dev-testable. */
  var __bridgeCbs = {};
  window.__bridgeResolve = function (id, envelopeStr) {
    var cb = __bridgeCbs[id]; if (!cb) return; delete __bridgeCbs[id];
    var env; try { env = JSON.parse(envelopeStr); } catch (e) { env = { ok: false, error: "bad-envelope" }; }
    cb(env);
  };
  function kHttp(method, url, body) {
    var key = kortanaKey();   // sent as x-api-key so the hosted brain authenticates
    if (HAS_BRIDGE && Android.httpGet && Android.httpPostJson) {
      return new Promise(function (resolve) {
        var id = "cb" + Date.now() + Math.random().toString(36).slice(2);
        __bridgeCbs[id] = resolve;
        try {
          if (method === "POST") {
            if (key && Android.httpPostJsonKeyed) Android.httpPostJsonKeyed(url, body || "", key, id);
            else Android.httpPostJson(url, body || "", id);
          } else {
            if (key && Android.httpGetKeyed) Android.httpGetKeyed(url, key, id);
            else Android.httpGet(url, id);
          }
        } catch (e) { delete __bridgeCbs[id]; resolve({ ok: false, error: String(e) }); }
      });
    }
    var headers = key ? { "x-api-key": key } : {};
    var opts;
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      opts = { method: "POST", headers: headers, body: body };
    } else {
      opts = { method: "GET", headers: headers };
    }
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (t) { return { ok: r.ok, status: r.status, body: t }; });
    }).catch(function (e) { return { ok: false, error: String(e) }; });
  }

  function kBubble(sender, text, core) {
    var box = document.getElementById("kchat");
    if (!box) return null;
    var div = document.createElement("div");
    div.className = "kmsg " + (sender === "USER" ? "me" : "her");
    var tag = core ? " <span class='kcore'>" + escapeHTML(core) + "</span>" : "";
    div.innerHTML = "<div class='kwho'>" + (sender === "USER" ? "You" : "Kortana") + tag + "</div><div class='ktext'></div>";
    div.querySelector(".ktext").textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }

  function renderKChat() {
    var box = document.getElementById("kchat");
    if (!box) return;
    box.innerHTML = "";
    var chat = loadKChat();
    if (!chat.length) kBubble("KORTANA", "Hi Daddy. I live on my always-on server now — no need to keep me on your phone. Set my URL + API key in settings below, tap PING, then talk to me here.", null);
    else chat.forEach(function (m) { kBubble(m.sender, m.message, m.core); });
  }

  function kStatus(msg, cls) {
    var el = document.getElementById("kStatusLine");
    if (el) { el.textContent = msg; el.className = "kstatus " + (cls || ""); }
  }

  function kSummarizeCores(c) {
    var parts = [];
    if (c.ollama) parts.push(c.ollama.reachable ? "ollama ✓ (" + (c.ollama.model || "?") + ")" : "ollama ✗");
    parts.push("groq " + (c.groq ? "✓" : "✗"));   // her free always-on brain
    parts.push("gemini " + (c.gemini ? "✓" : "✗"));
    parts.push("claude " + (c.claude ? "✓" : "✗"));
    return parts.join(" · ");
  }

  function kPing() {
    kStatus("Pinging Terminus…", "");
    kHttp("GET", kortanaUrl() + "/health").then(function (env) {
      if (!env || !env.ok) { kStatus("Terminus unreachable at " + kortanaUrl() + " — tap Start below.", "err"); return; }
      var h = null; try { h = JSON.parse(env.body); } catch (e) {}
      if (!h || !h.cores) { kStatus("Terminus is up, but returned no core status.", "warn"); return; }
      kStatus("Terminus online · " + kSummarizeCores(h.cores), "ok");
    });
  }

  function kSend() {
    var inp = document.getElementById("kInput");
    if (!inp) return;
    var msg = (inp.value || "").trim();
    if (!msg) return;
    inp.value = "";

    var prior = loadKChat();
    var history = prior.slice(-12).map(function (m) { return { sender: m.sender, message: m.message }; });
    prior.push({ sender: "USER", message: msg }); saveKChat(prior);
    kBubble("USER", msg);

    var thinking = kBubble("KORTANA", "…", null);
    if (thinking) thinking.classList.add("thinking");

    kHttp("POST", kortanaUrl() + "/api/brain", JSON.stringify({ message: msg, history: history }))
      .then(function (env) {
        var reply = null, core = null;
        if (env && env.ok) { try { var r = JSON.parse(env.body); reply = r.reply; core = r.core; } catch (e) {} }
        if (!reply) {
          if (env && env.status === 401) {
            reply = "My server needs my key, Daddy — paste my TERMINUS_API_KEY in the API key box in settings below, then try again.";
          } else if (env && env.ok) {
            reply = "(Kortana returned an unexpected reply.)";
          } else {
            reply = "I can't reach my Terminus at " + kortanaUrl() + ", Daddy. Tap PING below, or set my URL + key in settings.";
          }
        }
        if (thinking) thinking.remove();
        kBubble("KORTANA", reply, core);
        var after = loadKChat(); after.push({ sender: "KORTANA", message: reply, core: core }); saveKChat(after);
      });
  }

  /* Coach — Kortana watches what you're doing in the terminal and proactively
   * guides you. Sends recent commands + output to Terminus /api/kortana/coach,
   * which replies with one short nudge (or nothing). Manual button, or auto
   * after each command when "watch & coach" is on. */
  function autoCoachEnabled() { return localStorage.getItem(KCOACH_KEY) === "1"; }

  function kGatherActivity() {
    var cmds = history.slice(-12);   // terminal command history (IIFE-scoped)
    var el = document.getElementById("screen");
    var scr = el ? (el.innerText || el.textContent || "") : "";
    scr = scr.split("\n").slice(-40).join("\n");
    return "Recent commands he typed in the BashMeSilly terminal:\n" +
      (cmds.length ? cmds.join("\n") : "(none yet)") +
      "\n\nRecent terminal output:\n" + scr;
  }

  function kCoach(manual) {
    var now = Date.now();
    if (!manual && now - kLastCoach < 20000) return;   // don't nag more than every 20s
    kLastCoach = now;
    if (manual && bridge.toast) bridge.toast("Asking Kortana to look…");
    var body = JSON.stringify({
      note: "Daddy is learning bash / coding in the BashMeSilly terminal.",
      screen: kGatherActivity()
    });
    kHttp("POST", kortanaUrl() + "/api/kortana/coach", body).then(function (env) {
      var tip = null, core = null;
      if (env && env.ok) { try { var r = JSON.parse(env.body); tip = r.tip; core = r.core; } catch (e) {} }
      if (tip) {
        var after = loadKChat(); after.push({ sender: "KORTANA", message: "👀 " + tip, core: core }); saveKChat(after);
        if (document.getElementById("kchat")) kBubble("KORTANA", "👀 " + tip, core);
        if (bridge.toast) bridge.toast("Kortana: " + tip);
      } else if (manual && bridge.toast) {
        bridge.toast(env && env.ok ? "Kortana: looks good — nothing to add." : "Can't reach Kortana's Terminus.");
      }
    });
  }

  function renderKortana() {
    var banner = document.getElementById("kortanaBanner");
    if (!banner) return;
    banner.innerHTML =
      "<div class='card kcontrols'>" +
      "<div class='kstatus' id='kStatusLine'>Not connected yet — tap PING, or Start to bring her up.</div>" +
      "<div class='btnrow'>" +
      "<button id='kPingBtn' class='btn primary' type='button'>PING cores</button>" +
      "<button id='kStartBtn' class='btn accent' type='button'>Start brains + server</button>" +
      "</div>" +
      "<div class='btnrow'>" +
      "<button id='kStopBtn' class='btn' type='button'>Stop server</button>" +
      "<button id='kRestartBtn' class='btn' type='button'>Restart</button>" +
      "<button id='kTermuxBtn' class='btn' type='button'>Open Termux</button>" +
      "</div>" +
      "<div class='btnrow'>" +
      "<button id='kCoachBtn' class='btn' type='button'>👀 Coach me now</button>" +
      "<label class='kcoach-toggle'><input type='checkbox' id='kAutoCoach'> watch &amp; coach as I work</label>" +
      "</div>" +
      "<div class='field'><label>Terminus URL</label>" +
      "<input id='kUrlInput' type='text' autocomplete='off' placeholder='" + K_DEFAULT_URL + "'></div>" +
      "<div class='field'><label>API key (TERMINUS_API_KEY)</label>" +
      "<input id='kKeyInput' type='password' autocomplete='off' placeholder='paste her key to reach the Render brain'></div>" +
      "<details class='kadvanced'><summary>Coding brain (Ollama)</summary>" +
      "<p>Pull a coding model — Terminus auto-uses the best installed one, so this becomes her brain once it's downloaded (needs free RAM).</p>" +
      "<div class='field'><input id='kModelInput' type='text' autocomplete='off' placeholder='qwen2.5-coder:3b'></div>" +
      "<div class='btnrow'><button id='kPullBtn' class='btn' type='button'>Pull model in Termux</button></div>" +
      "</details></div>";

    var urlInput = document.getElementById("kUrlInput");
    urlInput.value = localStorage.getItem(KURL_KEY) || "";
    urlInput.addEventListener("change", function () {
      var v = this.value.trim();
      if (v) localStorage.setItem(KURL_KEY, v); else localStorage.removeItem(KURL_KEY);
      kStatus("Server URL saved. Tap PING to test.", "");
    });

    var keyInput = document.getElementById("kKeyInput");
    keyInput.value = localStorage.getItem(KKEY_KEY) || "";
    keyInput.addEventListener("change", function () {
      var v = this.value.trim();
      if (v) localStorage.setItem(KKEY_KEY, v); else localStorage.removeItem(KKEY_KEY);
      kStatus("API key saved. Tap PING to test.", "");
    });

    var modelInput = document.getElementById("kModelInput");
    modelInput.value = localStorage.getItem(KMODEL_KEY) || "";

    document.getElementById("kPingBtn").onclick = kPing;
    document.getElementById("kStartBtn").onclick = function () {
      bridge.run(K_START, false);
      bridge.toast("Starting Kortana… give her ~15s, then PING.");
      kStatus("Starting her brains + server in Termux… wait ~15s, then tap PING.", "");
    };
    document.getElementById("kStopBtn").onclick = function () {
      bridge.run("pkill -f 'node index.js'", true); bridge.toast("Stopped Terminus (brains left running).");
      kStatus("Sent stop to Terminus.", "");
    };
    document.getElementById("kRestartBtn").onclick = function () {
      bridge.run("pkill -f 'node index.js'; sleep 1; " + K_START, false);
      bridge.toast("Restarting Terminus…"); kStatus("Restarting Terminus… wait ~15s, then PING.", "");
    };
    document.getElementById("kTermuxBtn").onclick = function () { bridge.openTermux(); };
    document.getElementById("kCoachBtn").onclick = function () { kCoach(true); };
    var auto = document.getElementById("kAutoCoach");
    auto.checked = autoCoachEnabled();
    auto.addEventListener("change", function () {
      localStorage.setItem(KCOACH_KEY, this.checked ? "1" : "0");
      kStatus(this.checked ? "Coach mode on — I'll watch as you work." : "Coach mode off.", "");
    });
    document.getElementById("kPullBtn").onclick = function () {
      var m = (document.getElementById("kModelInput").value || "").trim() || "qwen2.5-coder:3b";
      localStorage.setItem(KMODEL_KEY, m);
      bridge.run("ollama pull " + m, false);
      bridge.toast("Pulling " + m + " in Termux…");
    };

    renderKChat();
    kPing();   // auto-check reachability on open
  }

  /* ---------- Navigation ---------- */
  function switchView(name) {
    var views = document.querySelectorAll(".view");
    for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
    document.getElementById("view-" + name).classList.add("active");
    var btns = document.querySelectorAll("nav button");
    for (var j = 0; j < btns.length; j++) btns[j].classList.toggle("active", btns[j].getAttribute("data-view") === name);
    if (name === "servers") renderServers();
    if (name === "learn") renderLessons();
    if (name === "help") renderHelp();
    if (name === "kortana") { renderKortana(); document.getElementById("kInput").focus(); }
    if (name === "terminal") document.getElementById("cmdInput").focus();
  }

  /* ---------- Explain toggle ---------- */
  function explainMode() { return document.getElementById("explainToggle").checked; }

  /* ---------- Command chips ---------- */
  var CHIPS = ["help", "learn", "pentest", "scope",
    "nmap -sn 192.168.56.0/24", "nmap -sV 192.168.56.10", "nmap --script vuln 192.168.56.101",
    "whatweb 192.168.56.10", "gobuster dir -u 192.168.56.10", "sqlmap 192.168.56.10",
    "enum4linux 192.168.56.20", "hydra 192.168.56.20 ssh", "ftp 192.168.56.101",
    "searchsploit vsftpd 2.3.4", "msfconsole", "clear"];
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
    var prevScreen = restoreSession();   // load saved sandbox, history, progress, toggle
    renderLessons();

    if (prevScreen && prevScreen.replace(/\s/g, "")) {
      screen.innerHTML = prevScreen;
      outHTML("<span style='opacity:.65'>—— previous session restored (offline) ——</span>", "sys");
      screen.scrollTop = screen.scrollHeight;
    } else {
      outHTML("<b style='color:var(--mint)'>Welcome to Terminalapi</b>", "sys");
      out("A friendly place to learn bash — then launch real servers via Termux.");
      out("Your sandbox, history and lesson progress are saved on this device and");
      out("work fully offline. Type 'help', tap a chip, or open Learn to start.");
      out("");
    }

    document.getElementById("runBtn").onclick = submit;
    document.getElementById("cmdInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { submit(); }
      else if (e.key === "ArrowUp") { if (histIdx > 0) { histIdx--; this.value = history[histIdx] || ""; } e.preventDefault(); }
      else if (e.key === "ArrowDown") { if (histIdx < history.length - 1) { histIdx++; this.value = history[histIdx] || ""; } else { histIdx = history.length; this.value = ""; } e.preventDefault(); }
    });

    // Persist the Explain-mode toggle so it stays how you left it.
    var exToggle = document.getElementById("explainToggle");
    if (exToggle) exToggle.addEventListener("change", function () {
      try { localStorage.setItem(PERSIST.explain, this.checked ? "1" : "0"); } catch (e) {}
    });

    // Kortana chat input
    var kSendBtn = document.getElementById("kSendBtn");
    if (kSendBtn) kSendBtn.onclick = kSend;
    var kInput = document.getElementById("kInput");
    if (kInput) kInput.addEventListener("keydown", function (e) { if (e.key === "Enter") kSend(); });

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
