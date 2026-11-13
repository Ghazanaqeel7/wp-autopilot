"use strict";
// WP Autopilot dashboard — no framework, no build step. All data via /api (Pages Function).

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let STATE = null;
let refreshTimer = null;

/* ---------------------------------------------------------------- api */
async function api(path, opts = {}) {
  const r = await fetch("/api" + path, {
    credentials: "same-origin",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) { showLogin(); throw new Error("unauthorized"); }
  const ct = r.headers.get("Content-Type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
  return data;
}
const fileText = (p) => api("/file?path=" + encodeURIComponent(p)).catch(() => null);
const fileJson = async (p) => { const t = await fileText(p); return t && typeof t === "object" ? t : null; };
const img = (p) => "/api/file?path=" + encodeURIComponent(p);

async function loadState(force) {
  if (!STATE || force) STATE = await api("/state");
  return STATE;
}

/* ---------------------------------------------------------------- ui helpers */
function toast(msg, ms = 4000) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), ms);
}
const STATUS = {
  active: ["ok", "Active"], pending_connect: ["warn", "Waiting for connection"], onboarding: ["info", "Onboarding"], error: ["bad", "Error"], archived: ["", "Archived"],
  new: ["info", "New"], needs_info: ["warn", "Needs info"], planned: ["info", "Planned"], applying: ["info", "Applying"],
  preview_ready: ["ok", "Ready for approval"], qa_failed: ["bad", "QA failed"], approved: ["info", "Approved"], live: ["ok", "Live"],
  rejected: ["", "Discarded"], rolled_back: ["warn", "Rolled back"],
};
const pill = (s) => { const [c, l] = STATUS[s] || ["", s || "—"]; return `<span class="pill ${c}">${esc(l)}</span>`; };
const ago = (iso) => {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago"; return Math.floor(s / 86400) + " d ago";
};
const KIND = { change: "Change", new_site: "New website", revamp: "Revamp", brief: "Brief", maintenance: "Maintenance" };

async function act(btn, body, msg) {
  btn.disabled = true;
  try { await api("/action", { method: "POST", body }); toast(msg || "Queued. This takes 1–5 minutes."); }
  catch (e) { toast("Failed: " + e.message, 7000); }
  finally { setTimeout(() => (btn.disabled = false), 4000); }
}

/* ---------------------------------------------------------------- views */
async function sitesView() {
  const st = await loadState(true);
  const open = (id) => st.requests.filter((r) => r.site === id && !["live", "rejected", "rolled_back"].includes(r.status)).length;
  view.innerHTML = `
    <div class="head"><div><h1>Sites</h1><p>${st.sites.length} connected website${st.sites.length === 1 ? "" : "s"}</p></div>
      <div class="row"><button class="btn" id="health">Run health check</button><a class="btn primary" href="#/new-site">Add website</a></div></div>
    ${st.sites.length ? `<div class="grid">${st.sites.map((s) => `
      <a class="card" href="#/site/${esc(s.id)}">
        <div class="row" style="justify-content:space-between"><span class="site-name">${esc(s.name)}</span>${pill(s.status)}</div>
        <div class="muted small" style="margin:4px 0 14px">${esc(s.url)}</div>
        <dl class="kv small">
          <dt>Builder</dt><dd>${esc(s.builder || "—")}</dd>
          <dt>Health</dt><dd>${s.health ? (s.health === "ok" ? "OK" : esc(s.health)) : "—"} <span class="muted">${s.last_health ? "· " + ago(s.last_health) : ""}</span></dd>
          <dt>Open requests</dt><dd>${open(s.id)}</dd>
        </dl></a>`).join("")}</div>`
      : `<div class="card empty">No websites yet. <a href="#/new-site">Add your first website</a>.</div>`}`;
  $("#health").onclick = (e) => act(e.target, { action: "health" }, "Health check started.");
}

async function siteView(id) {
  const st = await loadState(true);
  const s = st.sites.find((x) => x.id === id);
  if (!s) return (view.innerHTML = `<div class="card empty">Site not found.</div>`);
  const reqs = st.requests.filter((r) => r.site === id);
  const pending = s.status === "pending_connect" || s.status === "unknown" || !s.bridge?.version;
  const code = pending ? await fileText(`sites/${id}/connection-code.txt`) : null;
  view.innerHTML = `
    <div class="head"><div><div class="row"><h1>${esc(s.name)}</h1>${pill(s.status)}</div>
      <p><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>${s.client ? " · " + esc(s.client) : ""}</p></div>
      <div class="row"><button class="btn" id="onboard">${pending ? "Check connection" : "Refresh site data"}</button>
      <a class="btn primary" href="#/new-request?site=${esc(id)}">New request</a></div></div>
    ${pending ? `<div class="card"><h2>Connect this website</h2>
      <ol style="margin:0 0 16px;padding-left:20px;line-height:1.9">
        <li>Download <a href="/downloads/autopilot-bridge.zip">autopilot-bridge.zip</a> and install it on the site (Plugins → Add New → Upload → Activate).</li>
        <li>In wp-admin open <b>Tools → Autopilot Bridge</b>, paste the code below and press <b>Connect</b>.</li>
        <li>Come back and press <b>Check connection</b>.</li></ol>
      ${code && typeof code === "string" ? `<div class="code-box"><textarea readonly class="mono" id="code">${esc(code.trim())}</textarea>
        <button class="btn" id="copy">Copy</button></div>`
        : `<div class="notice">The connection code is being generated. Refresh in a minute.</div>`}</div>` : ""}
    <div class="cols" style="margin-top:20px">
      <div class="card"><h2>Requests</h2>${reqTable(reqs, false)}</div>
      <div class="card"><h2>Details</h2><dl class="kv small">
        <dt>Site ID</dt><dd class="mono">${esc(s.id)}</dd><dt>Type</dt><dd>${esc(s.type)}</dd>
        <dt>Builder</dt><dd>${esc(s.builder)}</dd><dt>Theme</dt><dd>${esc(s.theme || "—")}</dd>
        <dt>Pages</dt><dd>${esc(s.pages ?? "—")}</dd><dt>Bridge</dt><dd>${esc(s.bridge?.version || "not connected")}</dd>
        <dt>WordPress</dt><dd>${esc(s.bridge?.checks?.wp || "—")}</dd><dt>PHP</dt><dd>${esc(s.bridge?.checks?.php || "—")}</dd>
        <dt>Health</dt><dd>${esc(s.health || "—")} <span class="muted">${s.last_health ? ago(s.last_health) : ""}</span></dd>
        <dt>Last scan</dt><dd>${ago(s.last_inventory)}</dd></dl></div>
    </div>`;
  $("#onboard").onclick = (e) => act(e.target, { action: "onboard", site: id }, "Checking the site. Refresh in 1–2 minutes.");
  const c = $("#copy");
  if (c) c.onclick = async () => { await navigator.clipboard.writeText($("#code").value); toast("Code copied."); };
  bindRows();
}

function reqTable(reqs, withSite = true) {
  if (!reqs.length) return `<div class="empty">No requests yet.</div>`;
  return `<table><thead><tr><th>Request</th>${withSite ? "<th>Site</th>" : ""}<th>Status</th><th class="hide-sm">Updated</th></tr></thead><tbody>
    ${reqs.map((r) => `<tr class="click" data-href="#/req/${esc(r.id)}"><td><div style="font-weight:600">${esc(r.title || KIND[r.kind] || r.id)}</div>
      <div class="muted small mono">${esc(r.id)} · ${esc(KIND[r.kind] || r.kind)}</div></td>
      ${withSite ? `<td>${esc(r.site)}</td>` : ""}<td>${pill(r.status)}</td><td class="hide-sm muted small">${ago(r.updated_at || r.created_at)}</td></tr>`).join("")}
  </tbody></table>`;
}
function bindRows() {
  view.querySelectorAll("tr[data-href]").forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
}

async function requestsView() {
  const st = await loadState(true);
  view.innerHTML = `<div class="head"><div><h1>Requests</h1><p>Everything you asked for, newest first</p></div>
    <a class="btn primary" href="#/new-request">New request</a></div><div class="card">${reqTable(st.requests)}</div>`;
  bindRows();
}

async function requestView(id) {
  const st = await loadState(true);
  const r = st.requests.find((x) => x.id === id);
  if (!r) return (view.innerHTML = `<div class="card empty">Request not found.</div>`);
  const base = `reports/${r.site}/${id}`;
  const [md, meta, qa, prev] = await Promise.all([
    fileText(`requests/${id}/request.md`), fileJson(`${base}/meta.json`), fileJson(`${base}/qa.json`), fileJson(`${base}/preview.json`),
  ]);
  const text = typeof md === "string" ? (md.split("## Request")[1] || md).split("## ")[0].trim() : "";
  const previewOk = prev && new Date(prev.expires) > new Date() && ["preview_ready", "qa_failed"].includes(r.status);
  const lh = qa?.lighthouse;
  view.innerHTML = `
    <div class="head"><div><div class="row"><h1>${esc(r.title || id)}</h1>${pill(r.status)}</div>
      <p class="mono small">${esc(id)} · <a href="#/site/${esc(r.site)}">${esc(r.site)}</a> · ${esc(KIND[r.kind] || r.kind)} · created ${ago(r.created_at)}</p></div>
      <div class="row" id="actions"></div></div>
    ${r.status === "new" ? `<div class="notice">Waiting for Claude to plan this request.</div>` : ""}
    ${r.status === "needs_info" ? `<div class="notice warn">Claude needs more information — see questions below.</div>` : ""}
    ${r.error ? `<div class="notice bad">${esc(r.error)}</div>` : ""}
    ${previewOk ? `<div class="card"><h2>Preview</h2><p style="margin:0 0 12px">The whole site with this change, visible only to people who have this link. Expires ${esc(new Date(prev.expires).toLocaleString())}.</p>
      <div class="row"><a class="btn primary" href="${esc(prev.url)}" target="_blank" rel="noopener">Open preview</a><button class="btn" id="copy-prev">Copy link for QA / PM</button></div></div>` : ""}
    ${meta?.problems?.length || meta?.warnings?.length ? `<div class="card"><h2>QA findings</h2>
      ${meta.problems?.length ? `<div class="notice bad"><ul class="issues">${[...new Set(meta.problems)].map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
      ${meta.warnings?.length ? `<div class="notice warn"><b>Already on the live site (not caused by this change):</b><ul class="issues">${[...new Set(meta.warnings)].map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}</div>` : ""}
    <div class="card"><h2>Request</h2><p class="pre">${esc(text || "—")}</p><div id="questions"></div></div>
    ${lh ? `<div class="card"><h2>Lighthouse (mobile, before → after)</h2><div class="scores">
      ${["performance", "accessibility", "best_practices", "seo"].map((k) => `<div class="score"><b>${esc(lh.after?.[k] ?? "–")}</b>
        <span>${esc(k.replace("_", " "))} · before ${esc(lh.before?.[k] ?? "–")}</span></div>`).join("")}</div></div>` : ""}
    ${qa?.pages?.length ? `<div class="card"><h2>Screens — before / after</h2>${qa.pages.map((pg) => `
      <h3 class="mono small" style="margin:8px 0 12px">${esc(pg.path)}</h3><div class="shots">
      ${pg.viewports.map((v) => `<div class="shot-row"><div class="w">${v.width}px</div>
        <figure><figcaption>Live now</figcaption><img loading="lazy" alt="Before at ${v.width}px" src="${img(base + "/" + v.before.shot)}"></figure>
        <figure><figcaption>With change</figcaption><img loading="lazy" alt="After at ${v.width}px" src="${img(base + "/" + v.after.shot)}"></figure></div>`).join("")}
      </div>`).join("")}</div>` : ""}`;

  const acts = $("#actions");
  const btn = (label, cls, a, confirmMsg) => {
    const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = label;
    b.onclick = () => { if (!confirmMsg || confirm(confirmMsg)) act(b, { action: a, site: r.site, request: id }); };
    acts.appendChild(b);
  };
  if (r.status === "preview_ready") { btn("Discard", "danger", "discard", "Discard this change? The live site stays as it is."); btn("Approve & go live", "primary", "promote", "Publish this change to the live site?"); }
  if (r.status === "qa_failed") { btn("Discard", "danger", "discard", "Discard this change?"); btn("Re-run QA", "", "apply"); }
  if (r.status === "live") btn("Roll back", "danger", "rollback", "Restore the site to how it was before this change?");
  if (["error", "planned"].includes(r.status)) btn("Apply again", "", "apply");
  const cp = $("#copy-prev");
  if (cp) cp.onclick = async () => { await navigator.clipboard.writeText(prev.url); toast("Preview link copied."); };
  if (r.status === "needs_info") {
    const q = await fileText(`requests/${id}/questions.md`);
    if (typeof q === "string") $("#questions").innerHTML = `<h2 style="margin-top:16px">Questions from Claude</h2><p class="pre">${esc(q)}</p>`;
  }
  view.querySelectorAll(".shot-row img").forEach((im) => (im.onclick = () => {
    const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${im.src}" alt="">`;
    lb.onclick = () => lb.remove(); document.body.appendChild(lb);
  }));
  if (["new", "planned", "applying"].includes(r.status)) refreshTimer = setTimeout(() => route(), 30000);
}

async function newSiteView() {
  view.innerHTML = `<div class="head"><div><h1>Add website</h1><p>Works with any WordPress site you have wp-admin access to.</p></div></div>
    <div class="card"><form class="stack" id="f">
      <label>Website name<input name="name" required maxlength="80" placeholder="Acme Dental"></label>
      <label>URL<input name="url" required type="url" placeholder="https://example.com"></label>
      <label>Site ID <small>Short name used in the system — lowercase, numbers, dashes</small><input name="id" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" minlength="2" maxlength="40" placeholder="acme-dental"></label>
      <label>Client <small>Optional</small><input name="client" maxlength="80"></label>
      <label>Type<select name="type"><option value="existing">Existing site — maintain / change</option><option value="revamp">Existing site — revamp</option><option value="new">New site — build from scratch</option></select></label>
      <div class="row"><button class="btn primary" type="submit">Add website</button><a class="btn" href="#/">Cancel</a></div>
      <p class="err" id="err"></p></form></div>`;
  const f = $("#f");
  f.name.oninput = () => { if (!f.id.dataset.touched) f.id.value = f.name.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); };
  f.id.oninput = () => (f.id.dataset.touched = "1");
  f.onsubmit = async (e) => {
    e.preventDefault(); const b = f.querySelector("button[type=submit]"); b.disabled = true; $("#err").textContent = "";
    try {
      const d = Object.fromEntries(new FormData(f));
      await api("/sites", { method: "POST", body: d });
      toast("Website added. Generating the connection code…", 6000);
      STATE = null; location.hash = "#/site/" + d.id;
    } catch (err) { $("#err").textContent = err.message; b.disabled = false; }
  };
}

async function newRequestView(params) {
  const st = await loadState();
  const sites = st.sites.filter((s) => s.status === "active");
  view.innerHTML = `<div class="head"><div><h1>New request</h1><p>Describe what you need in plain words. Attach briefs, docs, screenshots or voice notes.</p></div></div>
    <div class="card"><form class="stack" id="f">
      <label>Website<select name="site" required>${sites.map((s) => `<option value="${esc(s.id)}" ${params.get("site") === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
        ${sites.length ? "" : `<small>No connected websites yet — <a href="#/new-site">add one</a> first.</small>`}</label>
      <label>Type<select name="kind"><option value="change">Change on the site</option><option value="new_site">Build a new website</option><option value="revamp">Revamp the website</option><option value="brief">Client brief form</option><option value="maintenance">Maintenance / fix</option></select></label>
      <label>Title <small>One line</small><input name="title" required maxlength="120" placeholder="Update pricing section on homepage"></label>
      <label>What needs to be done?<textarea name="text" required placeholder="Paste the client's message or describe the change…"></textarea></label>
      <label>Done when… <small>Optional</small><textarea name="acceptance" style="min-height:80px"></textarea></label>
      <label>Attachments <small>Up to 10 files, 8 MB total</small><input type="file" name="files" multiple></label>
      <div class="row"><button class="btn primary" type="submit" ${sites.length ? "" : "disabled"}>Send request</button><a class="btn" href="#/">Cancel</a></div>
      <p class="err" id="err"></p></form></div>`;
  const f = $("#f");
  f.onsubmit = async (e) => {
    e.preventDefault(); const b = f.querySelector("button[type=submit]"); b.disabled = true; $("#err").textContent = "";
    try {
      const files = await Promise.all([...f.files.files].map((file) => new Promise((res, rej) => {
        const rd = new FileReader(); rd.onload = () => res({ name: file.name, data: String(rd.result).split(",")[1] || "" }); rd.onerror = rej; rd.readAsDataURL(file);
      })));
      if (files.reduce((n, x) => n + x.data.length * 0.75, 0) > 8 * 1024 * 1024) throw new Error("Attachments are larger than 8 MB.");
      const d = Object.fromEntries(new FormData(f)); delete d.files;
      const res = await api("/requests", { method: "POST", body: { ...d, files } });
      toast("Request " + res.id + " created."); STATE = null; location.hash = "#/req/" + res.id;
    } catch (err) { $("#err").textContent = err.message; b.disabled = false; }
  };
}

async function activityView() {
  const runs = await api("/runs");
  const icon = (r) => r.status !== "completed" ? pill("applying").replace("Applying", "Running") :
    r.conclusion === "success" ? `<span class="pill ok">Done</span>` : r.conclusion === "cancelled" ? `<span class="pill">Cancelled</span>` : `<span class="pill bad">Failed</span>`;
  view.innerHTML = `<div class="head"><div><h1>Activity</h1><p>What the system did recently</p></div><button class="btn" id="re">Refresh</button></div>
    <div class="card">${runs.length ? `<table><thead><tr><th>Job</th><th>Status</th><th class="hide-sm">When</th><th></th></tr></thead><tbody>
      ${runs.map((r) => `<tr><td><div style="font-weight:600">${esc(r.name)}</div><div class="muted small">${esc(r.title)}</div></td><td>${icon(r)}</td>
        <td class="hide-sm muted small">${ago(r.created)}</td><td><a href="${esc(r.url)}" target="_blank" rel="noopener" class="small">Log</a></td></tr>`).join("")}
      </tbody></table>` : `<div class="empty">No activity yet.</div>`}</div>`;
  $("#re").onclick = () => route();
}

/* ---------------------------------------------------------------- router */
async function route() {
  clearTimeout(refreshTimer);
  const [path, query] = (location.hash.slice(1) || "/").split("?");
  const params = new URLSearchParams(query || "");
  const parts = path.split("/").filter(Boolean);
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on",
    (a.dataset.nav === "sites" && (!parts[0] || parts[0] === "site")) || (a.dataset.nav === "requests" && (parts[0] === "requests" || parts[0] === "req")) || a.dataset.nav === parts[0]));
  view.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    if (!parts[0]) await sitesView();
    else if (parts[0] === "site") await siteView(parts[1]);
    else if (parts[0] === "requests") await requestsView();
    else if (parts[0] === "req") await requestView(parts[1]);
    else if (parts[0] === "new-site") await newSiteView();
    else if (parts[0] === "new-request") await newRequestView(params);
    else if (parts[0] === "activity") await activityView();
    else view.innerHTML = `<div class="card empty">Page not found.</div>`;
    view.focus({ preventScroll: true });
  } catch (e) {
    if (e.message !== "unauthorized") view.innerHTML = `<div class="notice bad">Could not load: ${esc(e.message)}</div>`;
  }
}

function showLogin() { $("#app").hidden = true; $("#login").hidden = false; }
function showApp() { $("#login").hidden = true; $("#app").hidden = false; route(); }

$("#login-form").onsubmit = async (e) => {
  e.preventDefault(); $("#login-err").textContent = "";
  const b = e.target.querySelector("button"); b.disabled = true;
  try { await api("/login", { method: "POST", body: { password: e.target.password.value } }); e.target.reset(); showApp(); }
  catch (err) { $("#login-err").textContent = err.message === "unauthorized" ? "Wrong password" : err.message; }
  finally { b.disabled = false; }
};
$("#logout").onclick = async () => { await fetch("/api/logout"); STATE = null; showLogin(); };
window.addEventListener("hashchange", route);
api("/state").then((s) => { STATE = s; showApp(); }).catch(() => {});
