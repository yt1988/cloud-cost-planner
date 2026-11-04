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
  const pagePath = location.pathname.replace(/\/r\/[^/]*\/?$/, "/");   // a whole /r/<code> segment, not the r of /fr/
  const fromLink = shared && fromCode(decodeURIComponent(shared[1]));
  const { on: sharedOn, ...linked } = fromLink || fromQuery(location.search) || {};
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
    links(); latency(); summary();
    const q = toQuery(st);
    // a shared link keeps its address until the visitor changes something
    if (keepShared) keepShared = false; else { history.replaceState(null, "", pagePath + "?" + q + location.hash); if (banner) banner = banner.remove(); }
  }
  // one redraw per burst of input events (a timer, not requestAnimationFrame: that one stops in background tabs)
  const update = () => { syncInputs(); if (!raf) raf = setTimeout(render, 0); };

  // the bar pinned to the bottom on phones: the cheapest setup and its price, while the result is still below the screen
  function summary() {
    const best = rec.picks[0]?.r, F = formats(P.lang, cur, D.rates);
    $("sbName").textContent = best ? comboName(D, best) : T.v_none;
    $("sbPrice").innerHTML = best ? esc(F.money(best.total)) + "<small>" + esc(T.per_month) + "</small>" : "";
  }
  const resultCard = document.querySelector(".result");
  const placeBar = () => { $("sumbar").hidden = resultCard.getBoundingClientRect().top < innerHeight - 40; };
  addEventListener("scroll", placeBar, { passive: true }); addEventListener("resize", placeBar); placeBar();

  // links to other 1ms.dog tools, from the addresses the shell announces; none when self-hosted
  function links() {
    document.querySelectorAll("a[data-tool]").forEach(a => {
      const base = TOOLS[a.dataset.tool];
      if (!base) return;
      a.href = base + langDir + (a.dataset.p ? a.dataset.p + "/" : "");
      a.removeAttribute("data-pend");
    });
  }

  // ---- latency from this browser to each data center on the page, with Me2Cloud's endpoints and its method
  // (m2c.1ms.dog/endpoints.json, "howTo"): one warm-up request, then the median of three on the reused connection.
  // One data center at a time (parallel requests slow each other down), the picks first; results are kept across
  // redraws. Without the shell's m2c address (self-hosted) the slots stay empty.
  const LAT = new Map();
  let EPS = null;
  const endpoints = () => EPS ||= (TOOLS.m2c ? fetch(TOOLS.m2c + "/endpoints.json").then(r => r.json())
    .then(j => Object.fromEntries(j.endpoints.map(e => [e.id, e]))).catch(() => null) : Promise.resolve(null));
  async function rtt(e) {
    const once = async () => {
      const url = e.nobust ? e.url : e.url + (e.url.includes("?") ? "&" : "?") + "_=" + Math.random().toString(36).slice(2);
      const t0 = performance.now();
      if (e.method === "IMG") await new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = url; });
      else {
        const r = await fetch(url, { method: e.method === "HEAD" ? "HEAD" : "GET", mode: e.cors ? "cors" : "no-cors", cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(5000) });
        if (e.cors && e.method !== "HEAD") await r.arrayBuffer();
      }
      return performance.now() - t0;
    };
    try { await once(); } catch (x) { return null; }
    const ms = [];
    for (let i = 0; i < 3; i++) try { ms.push(await once()); } catch (x) {}
    return ms.length ? ms.sort((a, b) => a - b)[ms.length >> 1] : null;
  }
  const showLat = (id, ms) => document.querySelectorAll(`[data-ping="${CSS.escape(id)}"]`).forEach(el => {
    el.textContent = ms == null ? T.lat_na : fill(T.lat_ms, { ms: Math.round(ms) });
    el.classList.toggle("good", ms != null && ms < 80); el.classList.toggle("slow", ms != null && ms >= 200);
    el.removeAttribute("data-pend");
  });
  async function latency() {
    const eps = await endpoints();
    if (!eps) return;
    for (const id of new Set([...document.querySelectorAll("[data-ping]")].map(el => el.dataset.ping))) {
      if (!LAT.has(id)) LAT.set(id, eps[id] ? rtt(eps[id]) : Promise.resolve(null));
      showLat(id, await LAT.get(id));
    }
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
    const { share } = await import("/assets/share/share.js?v=8");
    const F = formats(P.lang, cur, D.rates);
    const slug = (SCENES.find(s => s.id === st.scene) || SCENES.find(s => s.id === nearestScene(st))).slug;
    const link = location.origin + langDir + slug + "/r/" + toCode(st, Date.now());
    const line = verdict(rec, T, F, D);
    // s broken into lines no wider than w with the current font: at spaces, or anywhere in CJK text; never cut short
    const breakLines = (x, s, w) => {
      const out = [];
      let cur = "";
      for (const part of String(s).match(/[⺀-鿿가-힯豈-﫿＀-￯]|[^\s⺀-鿿가-힯豈-﫿＀-￯]+\s*|\s+/g) || []) {
        if (cur && x.measureText((cur + part).trimEnd()).width > w) { out.push(cur.trim()); cur = part.trimStart(); } else cur += part;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    // the largest of sizes at which s takes at most n lines (more lines at the smallest, rather than "…"); sets the font
    const block = (x, s, w, sizes, n, weight, face) => {
      for (const z of sizes) {
        x.font = `${weight} ${z}px ${face}`;
        const ls = breakLines(x, s, w);
        if (ls.length <= n || z === sizes[sizes.length - 1]) return { ls, z, font: x.font, h: ls.length * Math.round(z * 1.25) };
      }
    };
    const card = (x, k, paint) => {
      const colors = [k.v("c1"), k.v("c2"), k.v("c3"), k.v("c4") || k.v("c3")], bw = k.W - k.P * 2, q = rec.q;
      const text = (b, color, xx, top) => {
        if (!paint) return;
        x.font = b.font; x.fillStyle = color;
        b.ls.forEach((ln, i) => x.fillText(ln, xx, top + b.z + i * Math.round(b.z * 1.25) - Math.round(b.z * 0.2)));
      };
      const right = (t, font, color, xx, yy) => { if (!paint) return; x.font = font; x.fillStyle = color; x.textAlign = "right"; x.fillText(t, xx, yy); x.textAlign = "left"; };
      let y = k.top - 4;
      const work = block(x, [q.vcpu > 0 ? fill(T.spec, { c: q.vcpu, r: F.num(q.ram) }) : T.spec_none, F.size(q.gb) + T.per_month, T["aud_" + q.aud]].join("  ·  "), bw, [24, 22, 20], 1, 500, k.F);
      text(work, k.v("muted"), k.P, y); y += work.h + 16;
      const [best, ...rest] = rec.picks;
      if (!best) { const b = block(x, T.v_none, bw, [34, 30, 26], 2, 700, k.F); text(b, k.v("fg"), k.P, y + 20); return y + 20 + b.h + 80; }
      // the cheapest: tags, name and place on the left, the price large on the right
      const price = F.money(best.r.total), pf = `700 66px ${k.M}`;
      x.font = pf; const pw = x.measureText(price).width, lw = bw - 56 - pw - 32;
      const tags = block(x, best.tags.map(t => T["tag_" + t]).join(" · "), lw, [24, 22], 2, 700, k.F);
      const name = block(x, comboName(D, best.r), lw, [30, 28, 26, 24], 2, 700, k.F);
      const place = block(x, T["reg_" + best.r.region] + (best.r.m ? " · " + best.r.m.loc : ""), lw, [22, 20], 2, 400, k.F);
      const boxH = Math.max(184, 24 + tags.h + 8 + name.h + 8 + place.h + 22);
      if (paint) {
        x.fillStyle = k.v("panel"); k.roundRect(x, k.P, y, bw, boxH, 18); x.fill();
        x.strokeStyle = colors[0]; x.lineWidth = 3; k.roundRect(x, k.P, y, bw, boxH, 18); x.stroke();
      }
      let iy = y + 24;
      text(tags, colors[0], k.P + 28, iy); iy += tags.h + 8;
      text(name, k.v("fg"), k.P + 28, iy); iy += name.h + 8;
      text(place, k.v("muted"), k.P + 28, iy);
      right(price, pf, k.v("fg"), k.P + bw - 28, y + boxH / 2 + 12);
      right(T.per_month, `400 22px ${k.F}`, k.v("muted"), k.P + bw - 28, y + boxH / 2 + 48);
      y += boxH + 20;
      // the others: tags over the setup on the left, the price on the right
      rest.forEach((p, i) => {
        const pr = F.money(p.r.total), rf = `700 34px ${k.M}`;
        x.font = rf; const w = bw - 56 - x.measureText(pr).width - 32;
        const tg = block(x, p.tags.map(t => T["tag_" + t]).join(" · "), w, [22, 20], 2, 700, k.F);
        const nm = block(x, comboName(D, p.r), w, [26, 24, 22], 2, 500, k.F);
        text(tg, colors[i + 1], k.P + 28, y); text(nm, k.v("fg"), k.P + 28, y + tg.h + 4);
        right(pr, rf, k.v("fg"), k.P + bw - 28, y + Math.max(36, (tg.h + 4 + nm.h) / 2 + 14));
        y += tg.h + 4 + nm.h + 20;
      });
      const aws = awsRef();
      if (aws) {
        const b = block(x, comboName(D, aws) + "  " + F.money(aws.total) + T.per_month + "  (" + F.num(aws.total / Math.max(best.r.total, 0.01)) + "×)", bw - 56, [24, 22, 20], 1, 400, k.F);
        text(b, k.v("muted"), k.P + 28, y + 4); y += b.h + 8;
      }
      return y + 76;
    };
    share({
      lang: P.lang, name: T.name, file: "cloud-cost", show: [], never: [], home: location.origin + langDir,
      link: () => link, text: () => line,
      // fitted into 1200 wide for the link preview, with nothing cut off by "…" (1ms-shell docs/tool-contract.md): the
      // workload first, then the cheapest setup and its monthly price large, the other picks one block each, AWS's price
      // for the same last. A long name shrinks a little, then wraps, and the card grows to hold it: the same layout runs
      // once without painting for the height, then again to paint
      height: (x, k) => card(x, k, false),
      draw: async (x, k) => { card(x, k, true); },
      foot: () => [fill(T.foot_short, { d: P.verified })],
      ts: Date.now(),
    }).open();
  });
  // AWS's price for the same workload, when it's notably dearer (as the verdict says)
  function awsRef() {
    const best = rec.picks[0]?.r;
    return best && rec.aws && rec.aws !== best && rec.aws.total > best.total * 1.05 ? rec.aws : null;
  }
  // a custom setup shares through the scenario it is closest to
  function nearestScene(s) {
    if (s.vcpu === 0) return "backup";
    if (s.staticPct === 0) return "proxy";
    if (s.gb >= 51200) return "media";
    if (s.storeGB >= 512) return "download";
    return s.gb >= 1024 ? "saas" : "blog";
  }

  // someone else's shared result: the shared banner above the verdict; "work out mine" takes the visitor to the inputs,
  // starting from their numbers. The banner goes once the visitor changes something.
  let banner = null;
  if (fromLink) import("/assets/share/share.js?v=8").then(({ received }) => {
    banner = received({ lang: P.lang, ts: sharedOn || Date.now(), at: $("verdictRow"), test: () => {
      $("inH").closest("section").scrollIntoView({ behavior: "smooth", block: "start" });
      $("gbN").focus({ preventScroll: true });
    } });
  });

  syncInputs();
  // the prerendered result matches the page's preset; redraw only if the link or saved currency changed it
  if (shared || location.search || cur !== P.cur) render(); else { rec = recommend(st, D); links(); latency(); summary(); }
})();
