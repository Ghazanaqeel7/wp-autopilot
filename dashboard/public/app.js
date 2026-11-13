"use strict";
// WP Autopilot console. Vanilla JS, no build step. Data via /api (Cloudflare Worker → GitHub).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $("#view");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let STATE = null;
let timer = null;

/* ================================================================ data */
async function api(path, opts = {}) {
  const r = await fetch("/api" + path, {
    credentials: "same-origin",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    method: opts.method || "GET",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) { showLogin(); throw new Error("unauthorized"); }
  const ct = r.headers.get("Content-Type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || `Request failed (${r.status})`);
  return data;
}
const file = (p) => api("/file?path=" + encodeURIComponent(p)).catch(() => null);
const fileUrl = (p) => "/api/file?path=" + encodeURIComponent(p);
async function state(force = true) {
  if (!STATE || force) STATE = await api("/state");
  paintChrome();
  return STATE;
}

/* ================================================================ vocab */
const S = {
  active: ["ok", "Active"], pending_connect: ["warn", "Awaiting connection"], onboarding: ["info", "Onboarding"],
  error: ["bad", "Error"], archived: ["", "Archived"],
  new: ["info", "Queued"], needs_info: ["warn", "Needs info"], changes_requested: ["info", "Revision queued"],
  planned: ["info", "Planned"], applying: ["info", "Applying"], preview_ready: ["ok", "Ready for review"],
  qa_failed: ["bad", "QA failed"], approved: ["info", "Approved"], live: ["ok", "Live"], rejected: ["", "Discarded"],
  rolled_back: ["warn", "Rolled back"],
};
const KIND = { change: "Change", new_site: "New website", revamp: "Revamp", brief: "Brief", maintenance: "Maintenance" };
const GROUPS = {
  review: ["preview_ready"], progress: ["new", "changes_requested", "planned", "applying", "approved"],
  attention: ["needs_info", "qa_failed", "error"], done: ["live", "rejected", "rolled_back"],
};
const badge = (s) => { const [c, l] = S[s] || ["", s || "—"]; return `<span class="badge ${c}">${esc(l)}</span>`; };
const ago = (iso) => {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
};
const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
const initials = (n) => String(n || "?").replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const host = (u) => { try { return new URL(u).host; } catch { return u; } };
const siteName = (id) => (STATE?.sites.find((s) => s.id === id) || {}).name || id;

function toast(msg, ms = 4200) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), ms);
}
function crumbs(...parts) {
  $("#crumbs").innerHTML = parts.map((p, i) => (i === parts.length - 1 ? `<b>${esc(p[0])}</b>` : `<a href="${p[1]}">${esc(p[0])}</a><span>/</span>`)).join("");
  document.title = `${parts[parts.length - 1][0]} · WP Autopilot`;
}
function paintChrome() {
  if (!STATE) return;
  const n = STATE.requests.filter((r) => r.status === "preview_ready").length;
  const c = $("#nav-count"); c.hidden = !n; c.textContent = n;
  const paused = STATE.config.paused;
  $("#system-state").className = "system-state" + (paused ? " paused" : "");
  $("#system-state").innerHTML = `<span class="dot"></span>${paused ? "Automation paused" : "All systems running"}`;
}
async function act(btn, body, msg) {
  btn.disabled = true;
  try { await api("/action", { method: "POST", body }); toast(msg || "Started. This usually takes 1–5 minutes."); }
  catch (e) { toast(e.message, 7000); }
  finally { setTimeout(() => (btn.disabled = false), 3000); }
}
const loading = () => (view.innerHTML = `<div class="panel panel-body">${'<div class="skeleton"></div>'.repeat(5)}</div>`);

/* ================================================================ overview */
async function overview() {
  crumbs(["Overview"]);
  const st = await state();
  const live = st.sites.filter((s) => s.status !== "archived");
  const by = (g) => st.requests.filter((r) => GROUPS[g].includes(r.status));
  const sick = live.filter((s) => s.status === "active" && s.health && s.health !== "ok");
  const pending = live.filter((s) => s.status === "pending_connect");
  const attention = [
    ...by("review").map((r) => ({ href: `#/req/${r.id}`, title: r.title, sub: `${siteName(r.site)} · ready for your review`, b: badge(r.status) })),
    ...by("attention").map((r) => ({ href: `#/req/${r.id}`, title: r.title, sub: `${siteName(r.site)} · ${(S[r.status] || [])[1]}`, b: badge(r.status) })),
    ...sick.map((s) => ({ href: `#/site/${s.id}`, title: s.name, sub: `Health: ${s.health}`, b: `<span class="badge bad">Down</span>` })),
    ...pending.map((s) => ({ href: `#/site/${s.id}`, title: s.name, sub: "Install the Bridge plugin and paste the connection code", b: badge(s.status) })),
  ];
  view.innerHTML = `
    <div class="page-head"><div><h1>Overview</h1><p>${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p></div>
      <div class="actions"><a class="btn" href="#/new-site">Add website</a></div></div>
    <div class="kpis">
      ${kpi("Websites", live.filter((s) => s.status === "active").length, `${live.length} total`, "#/sites")}
      ${kpi("Ready for review", by("review").length, "Waiting for your approval", "#/requests?g=review")}
      ${kpi("In progress", by("progress").length, "Queued or being applied", "#/requests?g=progress")}
      ${kpi("Needs attention", by("attention").length + sick.length, "Failed QA, questions or downtime", "#/requests?g=attention")}
    </div>
    <div class="split">
      <div class="stack">
        <section class="panel"><div class="panel-head"><h2>Needs your attention</h2><span class="muted">${attention.length || ""}</span></div>
          ${attention.length ? `<ul class="list">${attention.slice(0, 8).map((a) => `<li><a class="row-link" href="${a.href}">
            <div class="grow"><div class="cell-title ellipsis">${esc(a.title)}</div><div class="cell-sub ellipsis">${esc(a.sub)}</div></div>${a.b}</a></li>`).join("")}</ul>`
            : `<div class="empty"><b>You're all caught up</b>Nothing is waiting on you right now.</div>`}</section>
        <section class="panel"><div class="panel-head"><h2>Recent requests</h2><a class="muted" href="#/requests">View all</a></div>
          ${reqTable(st.requests.slice(0, 6))}</section>
      </div>
      <div class="stack">
        <section class="panel"><div class="panel-head"><h2>Websites</h2><a class="muted" href="#/sites">Manage</a></div>
          ${live.length ? `<ul class="list">${live.slice(0, 8).map((s) => `<li><a class="row-link" href="#/site/${esc(s.id)}">
            <span class="favicon">${esc(initials(s.name))}</span><div class="grow"><div class="cell-title ellipsis">${esc(s.name)}</div>
            <div class="cell-sub ellipsis">${esc(host(s.url))}</div></div>${badge(s.status)}</a></li>`).join("")}</ul>`
            : `<div class="empty">No websites yet.</div>`}</section>
        <section class="panel"><div class="panel-head"><h2>System</h2></div><div class="panel-body"><dl class="kv">
          <dt>Automation</dt><dd>${st.config.paused ? '<span class="badge warn">Paused</span>' : '<span class="badge ok">Running</span>'}</dd>
          <dt>QA widths</dt><dd class="num">${esc((st.config.qa?.viewports || []).join(", "))}</dd>
          <dt>Preview links</dt><dd>${esc(st.config.preview_link_ttl_hours || 72)} hours</dd></dl></div></section>
      </div>
    </div>`;
  bindRows();
}
const kpi = (label, value, sub, href) => `<a class="panel kpi" href="${href}"><div class="label">${esc(label)}</div>
  <div class="value">${value}</div><div class="sub">${esc(sub)}</div></a>`;

/* ================================================================ sites */
async function sites(params) {
  crumbs(["Sites"]);
  const st = await state();
  const f = params.get("f") || "all";
  const q = (params.get("q") || "").toLowerCase();
  const groups = {
    all: (s) => s.status !== "archived", active: (s) => s.status === "active" && !s.paused,
    pending: (s) => s.status === "pending_connect", paused: (s) => s.paused && s.status !== "archived", archived: (s) => s.status === "archived",
  };
  const labels = { all: "All", active: "Active", pending: "Awaiting connection", paused: "Paused", archived: "Archived" };
  const list = st.sites.filter(groups[f] || groups.all).filter((s) => !q || `${s.name} ${s.url} ${s.client}`.toLowerCase().includes(q));
  const open = (id) => st.requests.filter((r) => r.site === id && !GROUPS.done.includes(r.status)).length;
  view.innerHTML = `
    <div class="page-head"><div><h1>Sites</h1><p>Every WordPress site connected to Autopilot.</p></div>
      <div class="actions"><button class="btn" id="health">Run health check</button><a class="btn btn-primary" href="#/new-site">Add website</a></div></div>
    <div class="filters">${Object.keys(groups).map((k) => `<button class="chip ${k === f ? "on" : ""}" data-f="${k}">${labels[k]}<span class="n">${st.sites.filter(groups[k]).length}</span></button>`).join("")}</div>
    ${list.length ? `<div class="site-grid">${list.map((s) => `
      <a class="panel site-card" href="#/site/${esc(s.id)}">
        <div class="top"><div style="display:flex;gap:12px;min-width:0"><span class="favicon">${esc(initials(s.name))}</span>
          <div style="min-width:0"><div class="name ellipsis">${esc(s.name)}</div><div class="url ellipsis">${esc(host(s.url))}</div></div></div>
          ${s.paused ? '<span class="badge warn">Paused</span>' : badge(s.status)}</div>
        <div class="meta"><div><span>Builder</span><b>${esc(s.builder && s.builder !== "unknown" ? s.builder : "—")}</b></div>
          <div><span>Health</span><b>${s.health ? (s.health === "ok" ? "Healthy" : "Down") : "—"}</b></div>
          <div><span>Open</span><b class="num">${open(s.id)}</b></div></div></a>`).join("")}</div>`
      : `<div class="panel empty"><b>No sites here</b>${f === "all" && !q ? '<a href="#/new-site">Add your first website</a>' : "Try another filter."}</div>`}`;
  $$(".chip").forEach((c) => (c.onclick = () => go("#/sites", { f: c.dataset.f, q })));
  $("#health").onclick = (e) => act(e.target, { action: "health" }, "Health check started for all active sites.");
}

async function site(id, tab = "overview") {
  const st = await state();
  const s = st.sites.find((x) => x.id === id);
  if (!s) return notFound("Site");
  crumbs(["Sites", "#/sites"], [s.name]);
  const reqs = st.requests.filter((r) => r.site === id);
  const connected = !!s.bridge?.version && s.status === "active";
  const tabs = { overview: "Overview", brand: "Brand & assets", pages: "Pages", requests: `Requests (${reqs.length})`, settings: "Settings" };
  view.innerHTML = `
    <div class="page-head"><div><div class="title-row"><span class="favicon">${esc(initials(s.name))}</span><h1>${esc(s.name)}</h1>
      ${s.paused ? '<span class="badge warn">Paused</span>' : badge(s.status)}</div>
      <p><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(host(s.url))} ↗</a>${s.client ? ` · ${esc(s.client)}` : ""}</p></div>
      <div class="actions"><button class="btn" id="onboard">${connected ? "Rescan site" : "Check connection"}</button>
      <a class="btn btn-primary" href="#/new-request?site=${esc(id)}">New request</a></div></div>
    <nav class="tabs">${Object.entries(tabs).map(([k, l]) => `<a href="#/site/${esc(id)}/${k}" class="${k === tab ? "on" : ""}">${esc(l)}</a>`).join("")}</nav>
    <div id="tab"></div>`;
  $("#onboard").onclick = (e) => act(e.target, { action: "onboard", site: id }, connected ? "Rescanning the site." : "Checking the connection. Refresh in a minute.");
  const el = $("#tab");

  if (tab === "overview") {
    const code = connected ? null : await file(`sites/${id}/connection-code.txt`);
    el.innerHTML = `${connected ? "" : `<section class="panel"><div class="panel-head"><h2>Connect this website</h2></div><div class="panel-body">
        <ol class="steps"><li>Download <a href="/downloads/autopilot-bridge.zip"><b>autopilot-bridge.zip</b></a> and install it: Plugins → Add New → Upload → Activate.</li>
        <li>In wp-admin open <b>Tools → Autopilot Bridge</b>, paste the code and press <b>Connect</b>.</li><li>Press <b>Check connection</b> above.</li></ol>
        ${typeof code === "string" ? `<div class="code-box"><textarea readonly id="code" aria-label="Connection code">${esc(code.trim())}</textarea><button class="btn" id="copy">Copy</button></div>`
          : `<div class="callout">Generating the connection code — refresh in a minute.</div>`}</div></section>`}
      <div class="split">
        <section class="panel"><div class="panel-head"><h2>Recent requests</h2><a class="muted" href="#/site/${esc(id)}/requests">View all</a></div>${reqTable(reqs.slice(0, 6), false)}</section>
        <section class="panel"><div class="panel-head"><h2>Details</h2></div><div class="panel-body"><dl class="kv">
          <dt>Site ID</dt><dd class="mono">${esc(s.id)}</dd><dt>Type</dt><dd>${esc(s.type)}</dd>
          <dt>Builder</dt><dd>${esc(s.builder)}</dd><dt>Theme</dt><dd>${esc(s.theme || "—")}</dd>
          <dt>Pages</dt><dd class="num">${esc(s.pages ?? "—")}</dd><dt>WordPress</dt><dd>${esc(s.bridge?.checks?.wp || "—")}</dd>
          <dt>PHP</dt><dd>${esc(s.bridge?.checks?.php || "—")}</dd><dt>Bridge</dt><dd>${esc(s.bridge?.version || "Not connected")}</dd>
          <dt>Health</dt><dd>${esc(s.health || "—")} <span class="muted">${s.last_health ? ago(s.last_health) : ""}</span></dd>
          <dt>Last scan</dt><dd>${ago(s.last_inventory)}</dd></dl></div></section></div>`;
    const c = $("#copy");
    if (c) c.onclick = async () => { await navigator.clipboard.writeText($("#code").value); toast("Connection code copied."); };
  }
  if (tab === "pages") {
    const inv = await file(`sites/${id}/inventory.json`);
    const pages = inv?.pages || [];
    el.innerHTML = `<section class="panel">${pages.length ? `<table class="table"><thead><tr><th>Title</th><th class="hide-sm">Type</th><th>Builder</th><th class="hide-sm">Status</th><th class="hide-sm">Modified</th></tr></thead><tbody>
      ${pages.map((p) => `<tr><td><div class="cell-title">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title || "(no title)")} ↗</a>` : esc(p.title || "(no title)")}</div>
        <div class="cell-sub mono">#${p.id} · /${esc(p.slug)}</div></td><td class="hide-sm">${esc(p.type.replace("elementor_library", "template"))}</td>
        <td>${esc(p.builder)}</td><td class="hide-sm">${esc(p.status)}</td><td class="hide-sm muted">${ago(p.modified && p.modified.replace(" ", "T") + "Z")}</td></tr>`).join("")}
      </tbody></table>` : `<div class="empty"><b>No page data yet</b>Connect and scan the site to see its pages.</div>`}</section>`;
  }
  if (tab === "brand") await brandTab(el, id);
  if (tab === "requests") el.innerHTML = `<section class="panel">${reqTable(reqs, false)}</section>`;
  if (tab === "settings") {
    el.innerHTML = `<section class="panel"><div class="panel-head"><h2>General</h2></div><div class="panel-body">
      <form class="form" id="sf"><div class="form-grid"><label class="field"><span>Website name</span><input type="text" name="name" value="${esc(s.name)}" required maxlength="80"></label>
      <label class="field"><span>Client</span><input type="text" name="client" value="${esc(s.client || "")}" maxlength="80"></label></div>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save changes</button></div><p class="form-error" id="se"></p></form></div></section>
      <section class="panel"><div class="panel-head"><h2>Automation</h2></div><div class="panel-body">
        <div class="toggle"><div><b>Pause this website</b><p>No change will be sent to this site until you resume it.</p></div>
          <label class="switch"><input type="checkbox" id="pause" ${s.paused ? "checked" : ""} aria-label="Pause this website"><span></span></label></div></div></section>
      <section class="panel"><div class="panel-head"><h2>Danger zone</h2></div><div class="panel-body">
        <div class="toggle"><div><b>${s.status === "archived" ? "Restore website" : "Archive website"}</b><p>${s.status === "archived" ? "Bring it back to the active list." : "Hides it from the dashboard. History and backups are kept. Uninstall the Bridge plugin on the site to fully disconnect."}</p></div>
          <button class="btn ${s.status === "archived" ? "" : "btn-danger"}" id="arch">${s.status === "archived" ? "Restore" : "Archive"}</button></div></div></section>`;
    $("#sf").onsubmit = async (e) => {
      e.preventDefault(); const b = e.target.querySelector("button"); b.disabled = true;
      try { await api("/sites/update", { method: "POST", body: { id, ...Object.fromEntries(new FormData(e.target)) } }); toast("Saved."); }
      catch (err) { $("#se").textContent = err.message; } finally { b.disabled = false; }
    };
    $("#pause").onchange = async (e) => {
      try { await api("/sites/update", { method: "POST", body: { id, paused: e.target.checked } }); toast(e.target.checked ? "Website paused." : "Website resumed."); }
      catch (err) { e.target.checked = !e.target.checked; toast(err.message, 6000); }
    };
    $("#arch").onclick = async (e) => {
      const archive = s.status !== "archived";
      if (archive && !confirm(`Archive ${s.name}?`)) return;
      e.target.disabled = true;
      try { await api("/sites/update", { method: "POST", body: { id, archive } }); toast(archive ? "Website archived." : "Website restored."); go("#/sites"); }
      catch (err) { toast(err.message, 6000); e.target.disabled = false; }
    };
  }
  bindRows();
}

/* ================================================================ brand & assets */
const ASSET_KIND = { logo: "Logo", guidelines: "Brand guidelines", image: "Image", font: "Font", other: "Other" };
const readFiles = (files) => Promise.all(files.map((file) => new Promise((res, rej) => {
  const rd = new FileReader(); rd.onload = () => res({ name: file.name, data: String(rd.result).split(",")[1] || "" }); rd.onerror = rej; rd.readAsDataURL(file);
})));

async function brandTab(el, id) {
  const [raw, assets] = await Promise.all([file(`sites/${id}/brand.json`), api(`/assets?site=${encodeURIComponent(id)}`).catch(() => [])]);
  const b = raw && typeof raw === "object" ? raw : {};
  const c = b.colors || {}, f = b.fonts || {};
  const color = (name, label) => `<label class="field"><span>${label}</span><span class="color-field"><i class="swatch" style="background:${esc(c[name] || "transparent")}"></i>
    <input type="text" name="${name}" value="${esc(c[name] || "")}" placeholder="#000000" pattern="#[0-9a-fA-F]{3,8}" maxlength="9"></span></label>`;
  el.innerHTML = `
    <div class="callout">Claude reads everything on this page before any work on this website — fill it once and it is applied to every build and change.</div>
    <section class="panel"><div class="panel-head"><h2>Brand guidelines</h2>${b.updated_at ? `<span class="muted">Saved ${ago(b.updated_at)}</span>` : ""}</div><div class="panel-body">
      <form class="form" id="bf">
        <div class="form-grid three">${color("primary", "Primary colour")}${color("secondary", "Secondary colour")}${color("accent", "Accent colour")}</div>
        <div class="form-grid"><label class="field"><span>Heading font</span><input type="text" name="font_heading" value="${esc(f.heading || "")}" maxlength="80" placeholder="e.g. Manrope"></label>
          <label class="field"><span>Body font</span><input type="text" name="font_body" value="${esc(f.body || "")}" maxlength="80" placeholder="e.g. Inter"></label></div>
        <label class="field"><span>Business <small>— what the company does, where, and what makes it different</small></span><textarea name="business" style="min-height:90px" maxlength="1500">${esc(b.business || "")}</textarea></label>
        <div class="form-grid"><label class="field"><span>Audience</span><textarea name="audience" style="min-height:80px" maxlength="1000" placeholder="Who the website is for.">${esc(b.audience || "")}</textarea></label>
          <label class="field"><span>Tone of voice</span><textarea name="tone" style="min-height:80px" maxlength="1000" placeholder="e.g. Confident, plain, no jargon.">${esc(b.tone || "")}</textarea></label></div>
        <label class="field"><span>Always remember <small>— standing rules for this website</small></span><textarea name="always_remember" maxlength="4000" placeholder="e.g. Never show prices. WhatsApp button on every page. Client dislikes sliders.">${esc(b.always_remember || "")}</textarea></label>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Save brand guidelines</button></div><p class="form-error" id="be"></p></form></div></section>
    <section class="panel"><div class="panel-head"><h2>Assets</h2><span class="muted">${assets.length} file${assets.length === 1 ? "" : "s"}</span></div><div class="panel-body">
      <form class="form" id="af" style="max-width:none"><div class="asset-up"><label class="field"><span>Type</span><select name="kind">${Object.entries(ASSET_KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
        <label class="dropzone" id="adz"><input type="file" id="afiles" multiple hidden><b>Drop files here or click to browse</b><span>Logos, brand book PDF, photos, fonts — up to 8 MB per upload</span></label></div>
        <p class="form-error" id="ae"></p></form>
      ${assets.length ? `<ul class="asset-list">${assets.map((a) => { const [k, ...rest] = a.name.split("--"); const nm = rest.join("--") || a.name; const isImg = /\.(png|jpe?g|webp|gif|svg)$/i.test(a.name);
        const href = fileUrl(`sites/${id}/brand/assets/${a.name}`);
        return `<li>${isImg ? `<img src="${href}" alt="">` : `<span class="file-ico">${esc((a.name.split(".").pop() || "").slice(0, 4).toUpperCase())}</span>`}
          <div class="grow"><a href="${href}" target="_blank" rel="noopener" class="cell-title ellipsis">${esc(nm)}</a><div class="cell-sub">${esc(ASSET_KIND[k] || "Other")} · ${(a.size / 1024).toFixed(0)} KB</div></div>
          <button class="btn btn-sm btn-danger" data-del="${esc(a.name)}">Remove</button></li>`; }).join("")}</ul>`
        : `<div class="empty" style="padding:24px"><b>No assets yet</b>Upload the logo and brand guidelines first.</div>`}</div></section>`;
  $$(".color-field input", el).forEach((i) => (i.oninput = () => (i.previousElementSibling.style.background = /^#[0-9a-fA-F]{3,8}$/.test(i.value) ? i.value : "transparent")));
  $("#bf").onsubmit = async (e) => {
    e.preventDefault(); const btn = e.target.querySelector("button"); btn.disabled = true; $("#be").textContent = "";
    try { await api("/sites/brand", { method: "POST", body: { id, ...Object.fromEntries(new FormData(e.target)) } }); toast("Brand guidelines saved."); }
    catch (err) { $("#be").textContent = err.message; } finally { btn.disabled = false; }
  };
  const upload = async (list) => {
    if (!list.length) return;
    $("#ae").textContent = "";
    try {
      if (list.reduce((n, x) => n + x.size, 0) > 8 * 1024 * 1024) throw new Error("Files are larger than 8 MB in total — upload in smaller batches.");
      toast("Uploading…", 20000);
      await api("/assets", { method: "POST", body: { site: id, kind: $("#af").kind.value, files: await readFiles(list) } });
      toast("Uploaded."); route();
    } catch (err) { $("#ae").textContent = err.message; toast("Upload failed."); }
  };
  const dz = $("#adz");
  $("#afiles").onchange = (e) => upload([...e.target.files]);
  ["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => upload([...e.dataTransfer.files]));
  $$("[data-del]", el).forEach((btn) => (btn.onclick = async () => {
    if (!confirm("Remove this asset?")) return; btn.disabled = true;
    try { await api("/assets/delete", { method: "POST", body: { site: id, name: btn.dataset.del } }); toast("Removed."); route(); }
    catch (err) { toast(err.message, 6000); btn.disabled = false; }
  }));
}

/* ================================================================ requests */
function reqTable(reqs, withSite = true) {
  if (!reqs.length) return `<div class="empty"><b>No requests</b>New requests you send will appear here.</div>`;
  return `<table class="table"><thead><tr><th>Request</th>${withSite ? '<th class="hide-sm">Website</th>' : ""}<th>Status</th><th class="hide-sm">Updated</th></tr></thead><tbody>
    ${reqs.map((r) => `<tr class="link" data-href="#/req/${esc(r.id)}"><td><div class="cell-title">${r.urgent ? '<span class="tag urgent">Urgent</span> ' : ""}${esc(r.title || KIND[r.kind] || r.id)}</div>
      <div class="cell-sub"><span class="mono">${esc(r.id)}</span> · ${esc(KIND[r.kind] || r.kind)}${r.revision > 1 ? ` · revision ${r.revision}` : ""}</div></td>
      ${withSite ? `<td class="hide-sm">${esc(siteName(r.site))}</td>` : ""}<td>${badge(r.status)}</td><td class="hide-sm muted">${ago(r.updated_at || r.created_at)}</td></tr>`).join("")}
  </tbody></table>`;
}
function bindRows() { $$("tr[data-href]", view).forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.href; })); }

async function requests(params) {
  crumbs(["Requests"]);
  const st = await state();
  const g = params.get("g") || "all";
  const siteF = params.get("site") || "";
  const q = (params.get("q") || "").toLowerCase();
  const labels = { all: "All", review: "Ready for review", progress: "In progress", attention: "Needs attention", done: "Closed" };
  const inGroup = (r, k) => k === "all" || (GROUPS[k] || []).includes(r.status);
  const list = st.requests.filter((r) => inGroup(r, g) && (!siteF || r.site === siteF) && (!q || `${r.title} ${r.id} ${siteName(r.site)}`.toLowerCase().includes(q)));
  view.innerHTML = `
    <div class="page-head"><div><h1>Requests</h1><p>Changes and builds across all websites.</p></div>
      <div class="actions"><select id="sitef" aria-label="Filter by website" style="min-width:180px"><option value="">All websites</option>
        ${st.sites.map((s) => `<option value="${esc(s.id)}" ${s.id === siteF ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div></div>
    <div class="filters">${Object.keys(labels).map((k) => `<button class="chip ${k === g ? "on" : ""}" data-g="${k}">${labels[k]}<span class="n">${st.requests.filter((r) => inGroup(r, k)).length}</span></button>`).join("")}</div>
    <section class="panel">${reqTable(list)}</section>`;
  $$(".chip").forEach((c) => (c.onclick = () => go("#/requests", { g: c.dataset.g, site: siteF, q })));
  $("#sitef").onchange = (e) => go("#/requests", { g, site: e.target.value, q });
  bindRows();
}

async function request(id) {
  const st = await state();
  const r = st.requests.find((x) => x.id === id);
  if (!r) return notFound("Request");
  crumbs(["Requests", "#/requests"], [id]);
  const base = `reports/${r.site}/${id}`;
  const [md, meta, qa, prev, fb, qs] = await Promise.all([
    file(`requests/${id}/request.md`), file(`${base}/meta.json`), file(`${base}/qa.json`), file(`${base}/preview.json`),
    file(`requests/${id}/feedback.md`), r.status === "needs_info" ? file(`requests/${id}/questions.md`) : null,
  ]);
  const section = (name) => (typeof md === "string" ? ((md.split(`## ${name}`)[1] || "").split("\n## ")[0] || "").trim() : "");
  const attachments = section("Attachments").split("\n").map((l) => l.replace(/^- /, "").trim()).filter((l) => l && l !== "none");
  const refInfo = Object.fromEntries(section("Reference").split("\n").map((l) => l.match(/^- (\w+): (.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  if (refInfo.url && !/^https?:\/\//.test(refInfo.url)) delete refInfo.url;
  const previewOk = prev && prev.url && new Date(prev.expires) > new Date() && ["preview_ready", "qa_failed"].includes(r.status);
  const problems = [...new Set(meta?.problems || [])], warnings = [...new Set(meta?.warnings || [])];
  const lh = qa?.lighthouse;
  const steps = [
    ["Requested", r.created_at, true],
    ["Change prepared", meta?.staged_at, !!meta?.staged_at],
    [meta?.qa_passed === false ? "QA failed" : "QA passed", meta?.finalized_at, !!meta?.finalized_at, meta?.qa_passed === false],
    ["Live", meta?.promoted_at, !!meta?.promoted_at],
    ...(meta?.rolled_back_at ? [["Rolled back", meta.rolled_back_at, true, true]] : []),
  ];

  view.innerHTML = `
    <div class="page-head"><div><div class="title-row"><h1>${esc(r.title || id)}</h1>${badge(r.status)}${r.urgent ? '<span class="tag urgent">Urgent</span>' : ""}</div>
      <p><span class="mono">${esc(id)}</span> · <a href="#/site/${esc(r.site)}">${esc(siteName(r.site))}</a> · ${esc(KIND[r.kind] || r.kind)}${r.revision > 1 ? ` · revision ${r.revision}` : ""}</p></div>
      <div class="actions" id="acts"></div></div>
    ${r.status === "new" || r.status === "changes_requested" ? `<div class="callout">${r.status === "new" ? "Queued — Claude will plan this request on the next run." : "Your feedback is queued — Claude will prepare a revised version."}</div>` : ""}
    ${typeof qs === "string" ? `<div class="callout warn"><div><b>Claude needs more information</b><p class="prose" style="margin-top:6px">${esc(qs)}</p></div></div>` : ""}
    ${r.error ? `<div class="callout bad">${esc(r.error)}</div>` : ""}
    <div class="split"><div class="stack">
      ${previewOk ? `<section class="panel"><div class="panel-head"><h2>Preview</h2><span class="muted">Expires ${esc(fmt(prev.expires))}</span></div><div class="panel-body">
        <p style="margin:0 0 14px">The full website with this change applied. Only people with this link see it — the live site is untouched until you approve.</p>
        <div class="actions"><a class="btn btn-accent" href="${esc(prev.url)}" target="_blank" rel="noopener">Open preview ↗</a><button class="btn" id="cp">Copy link for QA / PM</button></div></div></section>` : ""}
      <div id="fbox"></div>
      ${problems.length || warnings.length ? `<section class="panel"><div class="panel-head"><h2>QA findings</h2></div><div class="panel-body">
        ${problems.length ? `<div class="callout bad"><div><b>Blocking</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div></div>` : ""}
        ${warnings.length ? `<div class="callout warn" style="margin-bottom:0"><div><b>Already on the live site — not caused by this change</b><ul>${warnings.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div></div>` : ""}
      </div></section>` : ""}
      ${qa?.pages?.length ? `<section class="panel"><div class="panel-head"><h2>Before / after</h2><div class="compare-tools">
          ${qa.pages.length > 1 ? `<select id="cpage" aria-label="Page">${qa.pages.map((p, i) => `<option value="${i}">${esc(p.path)}</option>`).join("")}</select>` : `<span class="mono muted">${esc(qa.pages[0].path)}</span>`}
          <div class="seg" id="cw">${qa.pages[0].viewports.map((v, i) => `<button type="button" data-i="${i}" class="${i === 0 ? "on" : ""}">${v.width}</button>`).join("")}</div>
          <div class="seg" id="cm"><button type="button" data-m="slider" class="on">Slider</button><button type="button" data-m="side">Side by side</button></div></div></div>
        <div class="panel-body" id="cview"></div></section>` : ""}
      <section class="panel"><div class="panel-head"><h2>Request</h2></div><div class="panel-body">
        <p class="prose">${esc(section("Request") || "—")}</p>
        ${attachments.length ? `<div style="margin-top:16px"><div class="muted" style="font-size:12px;margin-bottom:6px">Attachments</div><ul class="files">
          ${attachments.map((a) => `<li><a href="${fileUrl(`requests/${id}/${a}`)}" target="_blank" rel="noopener">${esc(a.split("/").pop())}</a></li>`).join("")}</ul></div>` : ""}
      </div></section>
      ${refInfo.url ? `<section class="panel"><div class="panel-head"><h2>Reference website</h2><span class="badge plain">${refInfo.mode === "replicate" ? "Replicate" : "Inspiration"}</span></div><div class="panel-body">
        <dl class="kv"><dt>URL</dt><dd><a href="${esc(refInfo.url)}" target="_blank" rel="noopener noreferrer">${esc(refInfo.url)} ↗</a></dd>
          <dt>Content</dt><dd>${refInfo.own_site === "yes" ? "Own website — text and images may be reused" : "Layout and structure only — their text and images are not copied"}</dd>
          ${refInfo.notes && refInfo.notes !== "-" ? `<dt>Notes</dt><dd>${esc(refInfo.notes)}</dd>` : ""}</dl>
        <div class="ref-shots"><img data-opt src="${fileUrl(`requests/${id}/reference/desktop.jpg`)}" alt="Reference website on desktop"><img data-opt src="${fileUrl(`requests/${id}/reference/mobile.jpg`)}" alt="Reference website on mobile"></div>
      </div></section>` : ""}
      ${typeof fb === "string" ? `<section class="panel"><div class="panel-head"><h2>Feedback history</h2></div><div class="panel-body">
        <p class="prose">${esc(fb.replace(/^# Feedback\s*/, "").replace(/^## /gm, ""))}</p></div></section>` : ""}
    </div><div class="stack">
      <section class="panel"><div class="panel-head"><h2>Progress</h2></div><div class="panel-body"><ul class="timeline">
        ${steps.map(([l, t, done, bad]) => `<li class="${bad ? "bad" : done ? "done" : ""}"><div>${esc(l)}</div><div class="when">${done ? esc(fmt(t)) : "Pending"}</div></li>`).join("")}</ul></div></section>
      ${lh ? `<section class="panel"><div class="panel-head"><h2>Lighthouse</h2><span class="muted">mobile</span></div><div class="panel-body"><div class="scores" style="grid-template-columns:1fr 1fr">
        ${["performance", "accessibility", "best_practices", "seo"].map((k) => { const v = lh.after?.[k] ?? 0; const c = v >= 90 ? "var(--ok)" : v >= 50 ? "#d08a00" : "var(--bad)";
          return `<div class="score"><div class="ring" style="--v:${v};--c:${c}"><b class="num">${lh.after?.[k] ?? "–"}</b></div><span>${esc(k.replace("_", " "))}</span>
          <span class="num">before ${esc(lh.before?.[k] ?? "–")}</span></div>`; }).join("")}</div></div></section>` : ""}
      <section class="panel"><div class="panel-head"><h2>Details</h2></div><div class="panel-body"><dl class="kv">
        <dt>Website</dt><dd><a href="#/site/${esc(r.site)}">${esc(siteName(r.site))}</a></dd><dt>Source</dt><dd>${esc(r.source || "—")}</dd>
        <dt>Created</dt><dd>${esc(fmt(r.created_at))}</dd><dt>Updated</dt><dd>${esc(fmt(r.updated_at))}</dd>
        ${r.approved_by ? `<dt>Approved by</dt><dd>${esc(r.approved_by)}</dd>` : ""}${meta?.snapshot_id ? `<dt>Backup</dt><dd class="mono">snapshot #${esc(meta.snapshot_id)}</dd>` : ""}
      </dl></div></section>
    </div></div>`;

  const acts = $("#acts");
  const add = (label, cls, fn) => { const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = label; b.onclick = () => fn(b); acts.appendChild(b); };
  const run = (a, q, msg) => (b) => { if (!q || confirm(q)) act(b, { action: a, site: r.site, request: id }, msg); };
  if (["preview_ready", "qa_failed"].includes(r.status)) {
    add("Discard", "btn-danger", run("discard", "Discard this change? The live site stays as it is.", "Discarding the change."));
    add("Request changes", "", () => feedbackBox(r));
  }
  if (r.status === "qa_failed") add("Run QA again", "", run("apply", null, "Re-running the change and QA."));
  if (r.status === "preview_ready") add("Approve & publish", "btn-accent", run("promote", "Publish this change to the live website?", "Publishing — a backup is taken first."));
  if (r.status === "live") add("Roll back", "btn-danger", run("rollback", "Restore the website to how it was before this change?", "Rolling back."));
  if (["error", "planned"].includes(r.status)) add("Apply again", "", run("apply", null, "Applying again."));

  $$("img[data-opt]", view).forEach((im) => { im.onerror = () => im.remove(); im.onclick = () => lightbox(im.src); });
  const cp = $("#cp"); if (cp) cp.onclick = async () => { await navigator.clipboard.writeText(prev.url); toast("Preview link copied."); };
  if (qa?.pages?.length) compare(qa, base);
  if (["new", "changes_requested", "planned", "applying", "approved"].includes(r.status)) timer = setTimeout(route, 30000);
}

function feedbackBox(r) {
  const box = $("#fbox");
  if (box.innerHTML) return $("#fb-text").focus();
  box.innerHTML = `<section class="panel"><div class="panel-head"><h2>Request changes</h2></div><div class="panel-body"><form class="form" id="fbf">
    <label class="field"><span>What should be different?</span><textarea id="fb-text" required placeholder="e.g. Make the heading shorter and use the brand green on the button."></textarea></label>
    <div class="form-actions"><button class="btn btn-primary" type="submit">Send to Claude</button><button class="btn" type="button" id="fbc">Cancel</button></div>
    <p class="form-error" id="fbe"></p></form></div></section>`;
  $("#fb-text").focus();
  $("#fbc").onclick = () => (box.innerHTML = "");
  $("#fbf").onsubmit = async (e) => {
    e.preventDefault(); const b = e.target.querySelector("[type=submit]"); b.disabled = true;
    try { await api("/requests/feedback", { method: "POST", body: { request: r.id, note: $("#fb-text").value } }); toast("Feedback sent — a revision is queued."); route(); }
    catch (err) { $("#fbe").textContent = err.message; b.disabled = false; }
  };
}

function compare(qa, base) {
  let page = 0, vi = 0, mode = "slider";
  const paint = () => {
    const v = qa.pages[page].viewports[vi];
    const b = fileUrl(`${base}/${v.before.shot}`), a = fileUrl(`${base}/${v.after.shot}`);
    $("#cview").innerHTML = mode === "slider"
      ? `<div class="compare-labels"><span>Live now</span><span>With change</span></div>
         <div class="compare" id="cmp" style="--pos:50%"><img class="layer" src="${b}" alt="Live site at ${v.width}px"><img class="layer after" src="${a}" alt="With change at ${v.width}px"><div class="handle"></div></div>
         <input class="compare-range" type="range" min="0" max="100" value="50" aria-label="Compare position" id="rng">`
      : `<div class="side-by-side"><figure><figcaption>Live now</figcaption><img src="${b}" alt="Live site at ${v.width}px" loading="lazy"></figure>
         <figure><figcaption>With change</figcaption><img src="${a}" alt="With change at ${v.width}px" loading="lazy"></figure></div>`;
    const rng = $("#rng"); if (rng) rng.oninput = () => $("#cmp").style.setProperty("--pos", rng.value + "%");
    $$("#cview img").forEach((im) => (im.ondblclick = () => lightbox(im.src)));
  };
  $$("#cw button").forEach((btn) => (btn.onclick = () => { vi = +btn.dataset.i; $$("#cw button").forEach((x) => x.classList.toggle("on", x === btn)); paint(); }));
  $$("#cm button").forEach((btn) => (btn.onclick = () => { mode = btn.dataset.m; $$("#cm button").forEach((x) => x.classList.toggle("on", x === btn)); paint(); }));
  const sel = $("#cpage"); if (sel) sel.onchange = () => { page = +sel.value; paint(); };
  paint();
}
function lightbox(src) { const d = document.createElement("div"); d.className = "lightbox"; d.innerHTML = `<img src="${src}" alt="">`; d.onclick = () => d.remove(); document.body.appendChild(d); }

/* ================================================================ forms */
async function newSite() {
  crumbs(["Sites", "#/sites"], ["Add website"]);
  view.innerHTML = `<div class="page-head"><div><h1>Add website</h1><p>Any WordPress site you can log in to. No hosting access needed.</p></div></div>
    <section class="panel"><div class="panel-body"><form class="form" id="f">
      <div class="form-grid"><label class="field"><span>Website name</span><input type="text" name="name" required maxlength="80" placeholder="Acme Dental"></label>
      <label class="field"><span>Client <small>optional</small></span><input type="text" name="client" maxlength="80"></label></div>
      <label class="field"><span>Website URL</span><input type="url" name="url" required placeholder="https://example.com"></label>
      <label class="field"><span>Site ID <small>— used in the system, lowercase and dashes</small></span><input type="text" name="id" required minlength="2" maxlength="40" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="acme-dental"></label>
      <label class="field"><span>What is this website?</span><select name="type"><option value="existing">Existing website — maintain and change</option><option value="revamp">Existing website — full revamp</option><option value="new">New website — build from scratch</option></select></label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Add website</button><a class="btn" href="#/sites">Cancel</a></div>
      <p class="form-error" id="err"></p></form></div></section>`;
  const f = $("#f");
  f.name.oninput = () => { if (!f.id.dataset.touched) f.id.value = f.name.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); };
  f.id.oninput = () => (f.id.dataset.touched = "1");
  f.onsubmit = async (e) => {
    e.preventDefault(); const b = f.querySelector("[type=submit]"); b.disabled = true; $("#err").textContent = "";
    try { const d = Object.fromEntries(new FormData(f)); await api("/sites", { method: "POST", body: d }); toast("Website added — preparing the connection code."); go("#/site/" + d.id); }
    catch (err) { $("#err").textContent = err.message; b.disabled = false; }
  };
}

async function newRequest(params) {
  crumbs(["Requests", "#/requests"], ["New request"]);
  const st = await state(false);
  const sites = st.sites.filter((s) => s.status === "active");
  view.innerHTML = `<div class="page-head"><div><h1>New request</h1><p>Describe it in plain words. Attach briefs, documents, screenshots or voice notes.</p></div></div>
    <section class="panel"><div class="panel-body"><form class="form" id="f">
      <div class="form-grid"><label class="field"><span>Website</span><select name="site" required>${sites.map((s) => `<option value="${esc(s.id)}" ${params.get("site") === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
        ${sites.length ? "" : `<small>No connected websites — <a href="#/new-site">add one</a> first.</small>`}</label>
      <label class="field"><span>Type</span><select name="kind"><option value="change">Change on the website</option><option value="new_site">Build a new website</option><option value="revamp">Revamp the website</option><option value="brief">Client brief form</option><option value="maintenance">Maintenance or fix</option></select></label></div>
      <label class="field"><span>Title</span><input type="text" name="title" required maxlength="120" placeholder="Update pricing on the homepage"></label>
      <label class="field"><span>What needs to be done?</span><textarea name="text" required placeholder="Paste the client's message or describe the change in detail…"></textarea></label>
      <label class="field"><span>Done when… <small>optional</small></span><textarea name="acceptance" style="min-height:80px" placeholder="How you'll know it's right."></textarea></label>
      <div class="field"><span>Attachments <small>— up to 10 files, 8 MB total</small></span>
        <label class="dropzone" id="dz"><input type="file" id="files" multiple hidden><b>Drop files here or click to browse</b><span>PDF, DOCX, images, audio</span></label><ul class="files" id="fl"></ul></div>
      <fieldset class="group"><legend>Reference website <small>optional</small></legend>
        <label class="field"><span>URL</span><input type="url" name="ref_url" placeholder="https://a-site-you-like.com"></label>
        <div class="choice"><label class="check"><input type="radio" name="ref_mode" value="inspired" checked><div><b>Use as inspiration</b><span>Similar feel and quality, redesigned for this business, its content and its brand colours.</span></div></label>
          <label class="check"><input type="radio" name="ref_mode" value="replicate"><div><b>Replicate</b><span>Same layout, sections, structure and interactions — with this business's own content, images and branding.</span></div></label></div>
        <label class="check"><input type="checkbox" name="ref_own"><div><b>The reference is our own website</b><span>Allows its text and images to be carried over too (redesign or migration). Other companies' text, photos and logos are never copied.</span></div></label>
        <label class="field"><span>What do you like about it? <small>optional</small></span><input type="text" name="ref_notes" maxlength="1000" placeholder="e.g. The hero layout and the pricing table."></label>
      </fieldset>
      <label class="check"><input type="checkbox" name="urgent"><div><b>Urgent</b><span>Starts Claude immediately when an Anthropic API key is configured (pay per use). Otherwise it goes to the front of the queue.</span></div></label>
      <div class="form-actions"><button class="btn btn-primary" type="submit" ${sites.length ? "" : "disabled"}>Send request</button><a class="btn" href="#/requests">Cancel</a></div>
      <p class="form-error" id="err"></p></form></div></section>`;
  let files = [];
  const list = () => ($("#fl").innerHTML = files.map((f, i) => `<li><span>${esc(f.name)}</span><span class="muted">${(f.size / 1024).toFixed(0)} KB · <a href="#" data-x="${i}">remove</a></span></li>`).join(""));
  const addFiles = (fl) => { files = [...files, ...fl].slice(0, 10); list(); };
  const dz = $("#dz");
  $("#files").onchange = (e) => addFiles([...e.target.files]);
  ["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));
  $("#fl").onclick = (e) => { if (e.target.dataset.x) { e.preventDefault(); files.splice(+e.target.dataset.x, 1); list(); } };
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target; const b = f.querySelector("[type=submit]"); b.disabled = true; $("#err").textContent = "";
    try {
      if (files.reduce((n, x) => n + x.size, 0) > 8 * 1024 * 1024) throw new Error("Attachments are larger than 8 MB in total.");
      const data = await readFiles(files);
      const d = Object.fromEntries(new FormData(f));
      const reference = d.ref_url ? { url: d.ref_url, mode: d.ref_mode, own: !!f.ref_own.checked, notes: d.ref_notes } : null;
      const res = await api("/requests", { method: "POST", body: { site: d.site, kind: d.kind, title: d.title, text: d.text, acceptance: d.acceptance, reference, urgent: !!f.urgent.checked, files: data } });
      toast(`Request ${res.id} created.`); go("#/req/" + res.id);
    } catch (err) { $("#err").textContent = err.message; b.disabled = false; }
  };
}

/* ================================================================ activity & settings */
async function activity() {
  crumbs(["Activity"]);
  const runs = await api("/runs");
  const st = (r) => r.status !== "completed" ? '<span class="badge info">Running</span>' : r.conclusion === "success" ? '<span class="badge ok">Done</span>'
    : r.conclusion === "cancelled" ? '<span class="badge">Cancelled</span>' : '<span class="badge bad">Failed</span>';
  view.innerHTML = `<div class="page-head"><div><h1>Activity</h1><p>Jobs the system ran — onboarding, changes, QA, publishing and health checks.</p></div>
    <button class="btn" id="re">Refresh</button></div>
    <section class="panel">${runs.length ? `<table class="table"><thead><tr><th>Job</th><th>Status</th><th class="hide-sm">Started</th><th></th></tr></thead><tbody>
      ${runs.map((r) => `<tr><td><div class="cell-title">${esc(r.name)}</div><div class="cell-sub ellipsis" style="max-width:520px">${esc(r.title)}</div></td><td>${st(r)}</td>
        <td class="hide-sm muted">${ago(r.created)}</td><td style="text-align:right"><a class="btn btn-sm" href="${esc(r.url)}" target="_blank" rel="noopener">Log ↗</a></td></tr>`).join("")}
      </tbody></table>` : `<div class="empty"><b>No activity yet</b></div>`}</section>`;
  $("#re").onclick = () => route();
  timer = setTimeout(route, 30000);
}

async function settings() {
  crumbs(["Settings"]);
  const st = await state();
  const c = st.config, lm = c.qa?.lighthouse_min || {};
  view.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>Applies to every website.</p></div></div>
    <section class="panel"><div class="panel-head"><h2>Automation</h2></div><div class="panel-body">
      <div class="toggle"><div><b>Pause all automation</b><p>Emergency stop. Nothing is sent to any website until you turn it back on.</p></div>
        <label class="switch"><input type="checkbox" id="gp" ${c.paused ? "checked" : ""} aria-label="Pause all automation"><span></span></label></div></div></section>
    <section class="panel"><div class="panel-head"><h2>Quality gate</h2><span class="muted">A change is blocked if a mobile Lighthouse score falls below these</span></div><div class="panel-body">
      <form class="form" id="qf"><div class="form-grid">
        ${["performance", "accessibility", "best_practices", "seo"].map((k) => `<label class="field"><span>${esc(k.replace("_", " ").replace(/^./, (m) => m.toUpperCase()))}</span><input type="number" min="0" max="100" name="${k}" value="${esc(lm[k] ?? "")}"></label>`).join("")}
        <label class="field"><span>Preview link lifetime <small>hours</small></span><input type="number" min="1" max="168" name="ttl" value="${esc(c.preview_link_ttl_hours || 72)}"></label></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Save</button></div><p class="form-error" id="qe"></p></form></div></section>
    <section class="panel"><div class="panel-head"><h2>Bridge plugin</h2></div><div class="panel-body">
      <div class="toggle"><div><b>Autopilot Bridge</b><p>Install on every website you add. Updates are announced here.</p></div><a class="btn" href="/downloads/autopilot-bridge.zip">Download .zip</a></div></div></section>
    <section class="panel"><div class="panel-head"><h2>Urgent requests</h2></div><div class="panel-body">
      <p style="margin:0" class="muted">Urgent requests start Claude immediately when the repository secret <span class="mono">ANTHROPIC_API_KEY</span> is set in GitHub → Settings → Secrets → Actions. Without it, urgent requests go to the front of the queue.</p></div></section>`;
  $("#gp").onchange = async (e) => {
    try { await api("/config", { method: "POST", body: { paused: e.target.checked } }); toast(e.target.checked ? "All automation paused." : "Automation resumed."); state(); }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message, 6000); }
  };
  $("#qf").onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); const b = e.target.querySelector("button"); b.disabled = true;
    try {
      await api("/config", { method: "POST", body: { preview_link_ttl_hours: +d.ttl, lighthouse_min: { performance: +d.performance, accessibility: +d.accessibility, best_practices: +d.best_practices, seo: +d.seo } } });
      toast("Settings saved.");
    } catch (err) { $("#qe").textContent = err.message; } finally { b.disabled = false; }
  };
}

async function search(q) {
  crumbs(["Search"]);
  const st = await state();
  const t = q.toLowerCase();
  const s = st.sites.filter((x) => `${x.name} ${x.url} ${x.client}`.toLowerCase().includes(t));
  const r = st.requests.filter((x) => `${x.title} ${x.id} ${siteName(x.site)}`.toLowerCase().includes(t));
  view.innerHTML = `<div class="page-head"><div><h1>Results for “${esc(q)}”</h1><p>${s.length + r.length} found</p></div></div>
    <section class="panel"><div class="panel-head"><h2>Websites</h2></div>${s.length ? `<ul class="list">${s.map((x) => `<li><a class="row-link" href="#/site/${esc(x.id)}"><span class="favicon">${esc(initials(x.name))}</span>
      <div class="grow"><div class="cell-title">${esc(x.name)}</div><div class="cell-sub">${esc(host(x.url))}</div></div>${badge(x.status)}</a></li>`).join("")}</ul>` : `<div class="empty">No websites match.</div>`}</section>
    <section class="panel"><div class="panel-head"><h2>Requests</h2></div>${reqTable(r)}</section>`;
  bindRows();
}

function notFound(what) { crumbs([what]); view.innerHTML = `<div class="panel empty"><b>${esc(what)} not found</b><a href="#/">Back to overview</a></div>`; }

/* ================================================================ router */
function go(hash, params) {
  const q = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString() : "";
  const next = hash + (q ? "?" + q : "");
  if (location.hash === next) route(); else location.hash = next;
}
async function route() {
  clearTimeout(timer);
  $("#sidebar").classList.remove("open");
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  const params = new URLSearchParams(qs || "");
  const p = path.split("/").filter(Boolean);
  const section = !p[0] ? "overview" : p[0] === "site" || p[0] === "new-site" ? "sites" : p[0] === "req" || p[0] === "new-request" ? "requests" : p[0];
  $$(".nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === section));
  if (route.last !== path) loading();
  route.last = path;
  try {
    if (!p[0]) await overview();
    else if (p[0] === "sites") await sites(params);
    else if (p[0] === "site") await site(p[1], p[2]);
    else if (p[0] === "requests") await requests(params);
    else if (p[0] === "req") await request(p[1]);
    else if (p[0] === "new-site") await newSite();
    else if (p[0] === "new-request") await newRequest(params);
    else if (p[0] === "activity") await activity();
    else if (p[0] === "settings") await settings();
    else if (p[0] === "search") await search(params.get("q") || "");
    else notFound("Page");
  } catch (e) {
    if (e.message !== "unauthorized") view.innerHTML = `<div class="callout bad">Could not load this page: ${esc(e.message)}</div>`;
  }
}

function showLogin() { $("#app").hidden = true; $("#login").hidden = false; }
function showApp() { $("#login").hidden = true; $("#app").hidden = false; route(); }

$("#login-form").onsubmit = async (e) => {
  e.preventDefault(); $("#login-err").textContent = "";
  const b = e.target.querySelector("button"); b.disabled = true;
  try { await api("/login", { method: "POST", body: { password: e.target.password.value } }); e.target.reset(); showApp(); }
  catch (err) { $("#login-err").textContent = err.message === "unauthorized" ? "That password is not correct." : err.message; }
  finally { b.disabled = false; }
};
$("#logout").onclick = async () => { await fetch("/api/logout"); STATE = null; showLogin(); };
$("#menu").onclick = () => $("#sidebar").classList.toggle("open");
$("#search").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.value.trim()) go("#/search", { q: e.target.value.trim() }); });
window.addEventListener("hashchange", route);
api("/state").then((s) => { STATE = s; showApp(); }).catch(() => {});
