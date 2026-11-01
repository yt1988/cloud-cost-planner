// Cloud Cost Planner in the browser: inputs → src/calc.mjs → src/view.mjs, redrawn on every change.
// The build puts calc.mjs, view.mjs, scenes.mjs and the price data inside this bundle (see scripts/build.mjs);
// the strings come from /assets/l.<lang>.<hash>.js (window.L1MS), the page's own settings from #data.
/* @lib */

(function () {
  const T = window.L1MS, P = JSON.parse(document.getElementById("data").textContent);
  const $ = id => document.getElementById(id);
  const LS = { theme: "cloud-cost:theme", lang: "cloud-cost:lang", cur: "cloud-cost:cur" };
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const meta = id => { const m = document.querySelector(`meta[name="${id}"]`); return m && /^https:\/\//.test(m.content) ? m.content.replace(/\/+$/, "") : null; };
  // the other 1ms.dog tools this page links to, at the addresses the shell announces (none when self-hosted)
  const TOOLS = { m2c: meta("m2c"), ls: meta("ls"), v2c: meta("v2c") };
  const langDir = P.lang === "en" ? "/" : "/" + P.lang.toLowerCase() + "/";

  // ---- state: the page's preset; a shared result (/…/r/<code>) or the address while editing (?v=1&…) on top
  const shared = /\/r\/([^/]+)\/?$/.exec(location.pathname);
  const pagePath = location.pathname.replace(/r\/[^/]*\/?$/, "");
  const linked = (shared && fromCode(decodeURIComponent(shared[1]))) || fromQuery(location.search);
  // a link names its own scenario (or none): the page's preset scenario doesn't stay highlighted for other numbers
  let st = linked ? { ...P.state, scene: "", ...linked } : { ...P.state };
  let cur = ["USD", "EUR", "CNY"].includes(store.get(LS.cur)) ? store.get(LS.cur) : P.cur;
  $("cur").value = cur;

  // Traffic and storage: a number in the unit the visitor picked (GB until they pick TB; 1 TB = 1024 GB). The unit is
  // theirs: nothing switches it, and switching it only shows the same amount in the other unit.
  const unit = { gb: 1, storeGB: 1 };
  const trim = v => +v.toFixed(2);

  function syncInputs() {
    document.querySelectorAll("[data-scene]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.scene === st.scene)));
    const size = SIZES.findIndex(([c, r, d]) => c === st.vcpu && r === st.ram && d === st.disk);
    const none = st.vcpu === 0 && st.ram === 0;
    document.querySelectorAll("[data-size]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.size === (none ? "none" : size >= 0 ? String(size) : "custom"))));
    $("custom").hidden = none || size >= 0;
    $("vcpu").value = st.vcpu; $("ram").value = st.ram; $("disk").value = st.disk;
    for (const [k, n] of [["gb", "gbN"], ["storeGB", "sgN"]]) if (document.activeElement !== $(n)) $(n).value = trim(st[k] / unit[k]);
    document.querySelectorAll("[data-unit]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === unit[b.dataset.unit])));
    $("stR").value = st.staticPct; $("stV").textContent = st.staticPct + "%";
    document.querySelectorAll("[data-aud]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.aud === st.aud)));
    $("count").value = st.count; $("objKB").value = st.objKB; $("shared").checked = st.shared; $("free").checked = st.free;
  }

  // ---- results
  let rec = null, raf = 0, keepShared = !!shared;
  function render() {
    raf = 0;
    const F = formats(P.lang, cur, D.rates);
    rec = recommend(st, D);
    $("verdict").textContent = verdict(rec, T, F, D);
    $("picks").innerHTML = picksHTML(rec, T, F, D);
    $("curve").innerHTML = curveHTML(rec, T, F, D, st);
    $("tbl").innerHTML = tableHTML(rec, T, F, D);
    links();
    const q = toQuery(st);
    // a shared link keeps its address until the visitor changes something
    if (keepShared) keepShared = false; else history.replaceState(null, "", pagePath + "?" + q + location.hash);
  }
  // one redraw per burst of input events (a timer, not requestAnimationFrame: that one stops in background tabs)
  const update = () => { syncInputs(); if (!raf) raf = setTimeout(render, 0); };

  // links to other 1ms.dog tools, from the addresses the shell announces; none when self-hosted
  function links() {
    document.querySelectorAll("a[data-tool]").forEach(a => {
      const base = TOOLS[a.dataset.tool];
      if (!base) return;
      a.href = base + langDir + (a.dataset.p ? a.dataset.p + "/" : "");
      a.removeAttribute("data-pend");
    });
  }

  // ---- inputs
  const set = (o, keepScene) => { st = { ...st, ...o }; if (!keepScene) st.scene = ""; update(); };
  document.querySelectorAll("[data-scene]").forEach(b => b.addEventListener("click", () => {
    const s = SCENES.find(x => x.id === b.dataset.scene);
    const { id, slug, ...v } = s;
    set({ ...v, scene: id }, true);
  }));
  document.querySelectorAll("[data-size]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.size;
    if (k === "none") set({ vcpu: 0, ram: 0, disk: 0, staticPct: 100 });
    else if (k === "custom") { $("custom").hidden = false; set({ vcpu: Math.max(1, st.vcpu || 1), ram: Math.max(0.5, st.ram || 1), disk: st.disk || 25 }); $("custom").hidden = false; $("vcpu").focus(); }
    else { const [c, r, d] = SIZES[+k]; set({ vcpu: c, ram: r, disk: d }); }
  }));
  for (const [id, key] of [["vcpu", "vcpu"], ["ram", "ram"], ["disk", "disk"], ["count", "count"], ["objKB", "objKB"]])
    $(id).addEventListener("input", () => { const v = parseFloat($(id).value); if (Number.isFinite(v) && v >= 0) set({ [key]: v }); });
  for (const [k, n] of [["gb", "gbN"], ["storeGB", "sgN"]])
    $(n).addEventListener("input", () => { const v = parseFloat($(n).value); if (Number.isFinite(v) && v >= 0) set({ [k]: Math.round(v * unit[k] * 100) / 100 }); });
  document.querySelectorAll("[data-unit]").forEach(b => b.addEventListener("click", () => { unit[b.dataset.unit] = +b.dataset.v; syncInputs(); }));
  $("stR").addEventListener("input", () => set({ staticPct: +$("stR").value }));
  document.querySelectorAll("[data-aud]").forEach(b => b.addEventListener("click", () => set({ aud: b.dataset.aud }, true)));
  $("shared").addEventListener("change", () => set({ shared: $("shared").checked }, true));
  $("free").addEventListener("change", () => set({ free: $("free").checked }, true));
  $("cur").addEventListener("change", () => { cur = $("cur").value; store.set(LS.cur, cur); update(); });

  // ---- theme: system → light → dark
  const themeBtn = $("theme"), TH = ["system", "light", "dark"];
  const applyTheme = th => {
    if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th); else document.documentElement.removeAttribute("data-theme");
    themeBtn.dataset.th = th; themeBtn.setAttribute("aria-label", T["th_" + th]);
  };
  applyTheme(TH.includes(store.get(LS.theme)) ? store.get(LS.theme) : "system");
  themeBtn.addEventListener("click", () => { const th = TH[(TH.indexOf(themeBtn.dataset.th) + 1) % 3]; store.set(LS.theme, th); applyTheme(th); });

  // ---- language: save first, then go (the shell syncs it across tools)
  $("lang").addEventListener("change", () => {
    const l = $("lang").value; store.set(LS.lang, l);
    location.href = P.paths[l] + (shared ? "r/" + shared[1] + "/" : location.search);
  });

  // ---- help dialog: questions on the left, one answer at a time; a picker on phones
  const help = $("help"), tabs = [...document.querySelectorAll("[data-hq]")], arts = [...document.querySelectorAll("[data-hqb]")], hs = $("helpSel");
  hs.innerHTML = tabs.map((b, i) => `<option value="${i}">${b.textContent.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</option>`).join("");
  const showQ = i => {
    i = Math.max(0, Math.min(tabs.length - 1, i));
    tabs.forEach((b, j) => b.setAttribute("aria-selected", String(i === j))); arts.forEach((a, j) => { a.hidden = i !== j; });
    hs.value = String(i);
    document.querySelectorAll("[data-hstep]").forEach(b => { b.disabled = (+b.dataset.hstep < 0 && i === 0) || (+b.dataset.hstep > 0 && i === tabs.length - 1); });
  };
  tabs.forEach((b, i) => b.addEventListener("click", () => showQ(i)));
  hs.addEventListener("change", () => showQ(+hs.value));
  document.querySelectorAll("[data-hstep]").forEach(b => b.addEventListener("click", () => showQ(+hs.value + +b.dataset.hstep)));
  let lastFocus = null;
  $("helpBtn").addEventListener("click", () => { lastFocus = document.activeElement; help.hidden = false; showQ(+hs.value || 0); help.querySelector("[data-close]").focus(); });
  const closeHelp = () => { help.hidden = true; if (lastFocus) lastFocus.focus(); };
  help.addEventListener("click", e => { if (e.target === help || e.target.closest("[data-close]")) closeHelp(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !help.hidden) closeHelp(); });

  // ---- share: the shared 1ms.dog dialog; the link lands on the scenario's own page
  $("share").addEventListener("click", async () => {
    const { share } = await import("/assets/share/share.js");
    const F = formats(P.lang, cur, D.rates);
    const slug = (SCENES.find(s => s.id === st.scene) || SCENES.find(s => s.id === nearestScene(st))).slug;
    const link = location.origin + langDir + slug + "/r/" + toCode(st);
    const line = verdict(rec, T, F, D);
    share({
      lang: P.lang, name: T.name, file: "cloud-cost", show: [], never: [], home: location.origin + langDir,
      link: () => link, text: () => line,
      // the verdict (up to three lines, starting below the QR code), then one box per pick, then the footer
      height: (x, k) => { x.font = `700 34px ${k.F}`; return k.top + 40 + Math.min(3, wrap(x, line, k.W - k.P * 2).length) * 46 + 16 + rec.picks.length * 144 + 80; },
      draw: async (x, k) => {
        let y = k.top + 40;
        x.fillStyle = k.v("fg"); x.font = `700 34px ${k.F}`;
        for (const ln of wrap(x, line, k.W - k.P * 2).slice(0, 3)) { x.fillText(ln, k.P, y); y += 46; }
        y += 16 - 34;
        const colors = [k.v("c1"), k.v("c2"), k.v("c3")];
        rec.picks.slice(0, 3).forEach((p, i) => {
          const bx = k.P, bw = k.W - k.P * 2, bh = 128;
          x.fillStyle = k.v("panel"); k.roundRect(x, bx, y, bw, bh, 16); x.fill();
          x.strokeStyle = colors[i]; x.lineWidth = i === 0 ? 3 : 1.5; k.roundRect(x, bx, y, bw, bh, 16); x.stroke();
          x.fillStyle = colors[i]; x.font = `700 22px ${k.F}`; x.fillText(p.tags.map(t => T["tag_" + t]).join(" · "), bx + 24, y + 38);
          x.fillStyle = k.v("fg"); x.font = `600 28px ${k.F}`; x.fillText(k.clip(x, comboName(D, p.r), bw - 300), bx + 24, y + 80);
          x.fillStyle = k.v("muted"); x.font = `400 20px ${k.F}`; x.fillText(k.clip(x, T["reg_" + p.r.region] + (p.r.m ? " · " + p.r.m.loc : ""), bw - 300), bx + 24, y + 110);
          x.fillStyle = k.v("fg"); x.font = `700 40px ${k.M}`; x.textAlign = "right"; x.fillText(F.money(p.r.total), bx + bw - 24, y + 76);
          x.font = `400 20px ${k.F}`; x.fillStyle = k.v("muted"); x.fillText(T.per_month, bx + bw - 24, y + 106); x.textAlign = "left";
          y += bh + 16;
        });
      },
      foot: () => [fill(T.foot_short, { d: P.verified })],
      ts: Date.now(),
    }).open();
  });
  function wrap(x, text, w) {
    const out = []; let line = "";
    for (const ch of text.split(/(?<=[\s，。、,])/)) {
      if (x.measureText(line + ch).width > w && line) { out.push(line.trim()); line = ""; }
      line += ch;
      while (x.measureText(line).width > w) { let i = line.length; while (i > 1 && x.measureText(line.slice(0, i)).width > w) i--; out.push(line.slice(0, i)); line = line.slice(i); }
    }
    if (line.trim()) out.push(line.trim());
    return out;
  }
  // a custom setup shares through the scenario it is closest to
  function nearestScene(s) {
    if (s.vcpu === 0) return "backup";
    if (s.staticPct === 0) return "proxy";
    if (s.gb >= 51200) return "media";
    if (s.storeGB >= 512) return "download";
    return s.gb >= 1024 ? "saas" : "blog";
  }

  syncInputs();
  // the prerendered result matches the page's preset; redraw only if the link or saved currency changed it
  if (shared || location.search || cur !== P.cur) render(); else { rec = recommend(st, D); links(); }
})();
