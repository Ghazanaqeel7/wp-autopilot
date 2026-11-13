// WP Autopilot dashboard API — Cloudflare Pages Function.
// Env: GITHUB_TOKEN (secret), GITHUB_REPO ("owner/repo"), DASHBOARD_PASSWORD (secret), SESSION_SECRET (secret).
// The GitHub token never reaches the browser; every route except /api/login needs a valid session cookie.

const SESSION_DAYS = 7;
const MAX_UPLOAD = 8 * 1024 * 1024;
const READ_PREFIXES = ["sites/", "reports/", "requests/", "state.json", "docs/"];
const WORKFLOWS = { onboard: "onboard.yml", apply: "apply.yml", health: "health.yml", decide: "decide.yml", urgent: "urgent.yml", reference: "reference.yml" };
const enc = new TextEncoder();

export async function onRequest(ctx) {
  try {
    return await handle(ctx);
  } catch (e) {
    return json({ error: e.message || String(e) }, e.status || 500);
  }
}

async function handle(ctx) {
  const { request, env, params } = ctx;
  const path = "/" + [].concat(params.path || []).join("/");
  {
    if (path.startsWith("/hooks/")) return hooks(path.slice(7), request, env, ctx);
    if (path === "/login" && request.method === "POST") return login(request, env);
    if (path === "/logout") return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    if (!(await authed(request, env))) return json({ error: "unauthorized" }, 401);
    const gh = github(env);
    const url = new URL(request.url);

    if (path === "/state" && request.method === "GET") return json(await loadState(gh));
    if (path === "/file" && request.method === "GET") return file(gh, url.searchParams.get("path") || "");
    if (path === "/runs" && request.method === "GET") return json(await runs(gh));
    if (path === "/sites" && request.method === "POST") return addSite(gh, await request.json());
    if (path === "/requests" && request.method === "POST") return newRequest(gh, await request.json());
    if (path === "/action" && request.method === "POST") return action(gh, await request.json());
    if (path === "/sites/update" && request.method === "POST") return updateSite(gh, await request.json());
    if (path === "/sites/brand" && request.method === "POST") return saveBrand(gh, await request.json());
    if (path === "/assets" && request.method === "GET") return listAssets(gh, url.searchParams.get("site") || "");
    if (path === "/assets" && request.method === "POST") return uploadAssets(gh, await request.json());
    if (path === "/assets/delete" && request.method === "POST") return deleteAsset(gh, await request.json());
    if (path === "/inbox" && request.method === "GET") return inboxList(gh);
    if (path === "/inbox/add" && request.method === "POST") return inboxManual(gh, await request.json());
    if (path === "/inbox/convert" && request.method === "POST") return inboxConvert(gh, await request.json());
    if (path === "/inbox/ignore" && request.method === "POST") return inboxIgnore(gh, await request.json());
    if (path === "/sites/channels" && request.method === "POST") return saveChannels(gh, await request.json());
    if (path.startsWith("/connections")) return connections(path.slice(12), request, env, url);
    if (path === "/config" && request.method === "POST") return updateConfig(gh, await request.json());
    if (path === "/requests/feedback" && request.method === "POST") return feedback(gh, await request.json());
    return json({ error: "not found" }, 404);
  }
}

/* ---------------------------------------------------------------- auth */

async function login(request, env) {
  if (!env.DASHBOARD_PASSWORD || !env.SESSION_SECRET) return json({ error: "Dashboard is not configured (env vars missing)." }, 500);
  const body = await request.json().catch(() => ({}));
  await sleep(400); // slows guessing
  if (!(await safeEqual(String(body.password || ""), env.DASHBOARD_PASSWORD))) return json({ error: "Wrong password" }, 401);
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = `${exp}.${await hmac(env.SESSION_SECRET, String(exp))}`;
  return json({ ok: true }, 200, { "Set-Cookie": cookie(token, SESSION_DAYS * 86400) });
}

async function authed(request, env) {
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)ap_session=([^;]+)/);
  if (!m || !env.SESSION_SECRET) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(env.SESSION_SECRET, exp));
}

function cookie(value, maxAge) {
  return `ap_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function safeEqual(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

/* ---------------------------------------------------------------- github */

function github(env) {
  const repo = env.GITHUB_REPO;
  const base = `${env.GITHUB_API || "https://api.github.com"}/repos/${repo}`; // GITHUB_API: tests only
  async function call(method, p, body, accept = "application/vnd.github+json") {
    const r = await fetch(base + p, {
      method,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: accept,
        "User-Agent": "wp-autopilot-dashboard",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok && r.status !== 404) {
      const t = await r.text();
      throw Object.assign(new Error(`GitHub ${r.status}: ${t.slice(0, 200)}`), { status: r.status === 409 ? 409 : 502 });
    }
    return r;
  }
  return {
    async getJson(p) {
      const r = await call("GET", `/contents/${p}`, null, "application/vnd.github.raw+json");
      return r.status === 404 ? null : r.json();
    },
    async getRaw(p) {
      const r = await call("GET", `/contents/${p}`, null, "application/vnd.github.raw+json");
      return r.status === 404 ? null : r;
    },
    async list(p) {
      const r = await call("GET", `/contents/${p}`);
      return r.status === 404 ? [] : r.json();
    },
    async sha(p) {
      const r = await call("GET", `/contents/${p}`);
      return r.status === 404 ? null : (await r.json()).sha;
    },
    async put(p, contentB64, message) {
      const sha = await this.sha(p);
      const r = await call("PUT", `/contents/${p}`, { message, content: contentB64, ...(sha ? { sha } : {}) });
      return r.json();
    },
    async del(p, message) {
      const sha = await this.sha(p);
      if (sha) await call("DELETE", `/contents/${p}`, { message, sha });
    },
    async dispatch(workflow, inputs) {
      await call("POST", `/actions/workflows/${workflow}/dispatches`, { ref: "main", inputs });
    },
    async runs() {
      const r = await call("GET", `/actions/runs?per_page=20`);
      return r.json();
    },
  };
}

function bufB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64(s) {
  const bytes = enc.encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* ---------------------------------------------------------------- routes */

async function loadState(gh) {
  const state = (await gh.getJson("state.json")) || { sites: [], requests: [] };
  const dirs = (await gh.list("sites")).filter((d) => d.type === "dir" && !d.name.startsWith("_"));
  const sites = await Promise.all(
    dirs.map(async (d) => {
      const cfg = (await gh.getJson(`sites/${d.name}/site.json`)) || { id: d.name };
      const live = state.sites.find((s) => s.id === d.name) || {};
      return { ...cfg, ...live, id: d.name };
    })
  );
  return { config: state.config || {}, sites, requests: (state.requests || []).slice().reverse() };
}

async function file(gh, p) {
  if (!READ_PREFIXES.some((x) => p.startsWith(x)) || p.includes("..")) return json({ error: "forbidden path" }, 403);
  const r = await gh.getRaw(p);
  if (!r) return json({ error: "not found" }, 404);
  const ext = (p.split(".").pop() || "").toLowerCase();
  const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
    pdf: "application/pdf", json: "application/json", md: "text/plain; charset=utf-8", txt: "text/plain; charset=utf-8" };
  return new Response(r.body, { headers: {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": ext === "jpg" ? "private, max-age=86400" : "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    ...(types[ext] ? {} : { "Content-Disposition": `attachment; filename="${p.split("/").pop().replace(/[^A-Za-z0-9._-]/g, "_")}"` }),
  } });
}

async function runs(gh) {
  const d = await gh.runs();
  return (d.workflow_runs || []).map((r) => ({
    id: r.id, name: r.name, title: r.display_title, status: r.status, conclusion: r.conclusion,
    created: r.created_at, url: r.html_url, event: r.event,
  }));
}

async function addSite(gh, b) {
  const id = String(b.id || "").trim().toLowerCase();
  const url = String(b.url || "").trim().replace(/\/+$/, "");
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return json({ error: "Site ID: 2–40 lowercase letters, numbers or dashes." }, 400);
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(url)) return json({ error: "URL must start with https://" }, 400);
  if (await gh.sha(`sites/${id}/site.json`)) return json({ error: "A site with this ID already exists." }, 409);
  const site = {
    id, tenant: "default", name: String(b.name || id).slice(0, 80), client: String(b.client || "").slice(0, 80), url,
    type: ["existing", "new", "revamp"].includes(b.type) ? b.type : "existing", status: "pending_connect", paused: false,
    builder: "unknown", theme: "", css_prefix: (id.replace(/[^a-z]/g, "").slice(0, 4) || "ap") + "-", bridge: {}, channels: {},
    created_at: new Date().toISOString(),
  };
  await gh.put(`sites/${id}/site.json`, b64(JSON.stringify(site, null, 2) + "\n"), `dashboard: add site ${id}`);
  return json({ ok: true, id });
}

async function newRequest(gh, b) {
  return json(await createRequest(gh, b));
}

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Shared by the dashboard form, the Inbox and the webhooks. Throws on invalid input.
async function createRequest(gh, b) {
  const site = String(b.site || "");
  const text = String(b.text || "").trim();
  if (!/^[a-z0-9-]{2,40}$/.test(site) || !text) throw bad("Choose a site and describe the request.");
  const source = ["dashboard", "slack", "trello", "clickup", "email", "chat", "document", "raw", "other"].includes(b.source) ? b.source : "dashboard";
  const origin = b.origin && typeof b.origin === "object" ? b.origin : null;
  const kind = ["change", "new_site", "revamp", "brief", "maintenance"].includes(b.kind) ? b.kind : "change";
  const rb = b.reference || {};
  const refUrl = String(rb.url || "").trim();
  if (refUrl && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(refUrl)) throw bad("Reference URL must start with http:// or https://");
  const ref = refUrl ? { url: refUrl.slice(0, 300), mode: rb.mode === "replicate" ? "replicate" : "inspired", own: !!rb.own,
    notes: String(rb.notes || "").replace(/\s+/g, " ").trim().slice(0, 1000) } : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await gh.getJson("state.json");
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const n = state.requests.filter((r) => r.id.startsWith(`R${day}-`)).length + 1;
    const id = `R${day}-${String(n).padStart(3, "0")}`;

    const files = Array.isArray(b.files) ? b.files.slice(0, 10) : [];
    let total = 0;
    const names = [];
    for (const f of files) {
      const name = String(f.name || "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
      total += (f.data || "").length * 0.75;
      if (total > MAX_UPLOAD) throw bad("Attachments are larger than 8 MB in total.");
      await gh.put(`requests/${id}/attachments/${name}`, f.data, `dashboard: attachment for ${id}`);
      names.push(name);
    }
    const refMd = ref ? `\n\n## Reference\n- url: ${ref.url}\n- mode: ${ref.mode}\n- own_site: ${ref.own ? "yes" : "no"}\n- notes: ${ref.notes || "-"}` : "";
    const md = `---\nid: ${id}\nsite: ${site}\nkind: ${kind}\nsource: ${source}\n---\n\n## Request\n${text}${refMd}${origin ? `\n\n## Origin\n- source: ${source}\n- url: ${clip(origin.url, 300) || "-"}\n- from: ${clip(origin.from, 120) || "-"}` : ""}\n\n## Attachments\n${
      names.map((n) => `- attachments/${n}`).join("\n") || "- none"
    }\n\n## Acceptance\n${String(b.acceptance || "").trim() || "- (as described above)"}\n`;
    await gh.put(`requests/${id}/request.md`, b64(md), `dashboard: request ${id}`);

    const fresh = await gh.getJson("state.json");
    if (fresh.requests.some((r) => r.id === id)) continue; // id taken meanwhile → retry
    const now = new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
    const urgent = !!b.urgent;
    fresh.requests.push({ id, site, kind, status: "new", source, urgent, ...(origin ? { origin: cleanOrigin(origin) } : {}), ...(ref ? { reference: { url: ref.url, mode: ref.mode } } : {}), title: String(b.title || text).slice(0, 120), created_at: now, updated_at: now });
    try {
      await gh.put("state.json", b64(JSON.stringify(fresh, null, 2) + "\n"), `dashboard: new request ${id}`);
      if (ref) await gh.dispatch(WORKFLOWS.reference, { request: id }).catch(() => {});
      if (urgent) await gh.dispatch(WORKFLOWS.urgent, { request: id }).catch(() => {});
      return { ok: true, id, urgent };
    } catch (e) {
      if (e.status !== 409) throw e;
    }
  }
  throw bad("Busy — please try again.", 409);
}

async function action(gh, b) {
  const a = String(b.action || "");
  const site = String(b.site || "");
  const req = String(b.request || "");
  if (site && !/^[a-z0-9-]{2,40}$/.test(site)) return json({ error: "bad site" }, 400);
  if (req && !/^R\d{8}-\d{3}$/.test(req)) return json({ error: "bad request id" }, 400);
  if (["promote", "rollback", "discard"].includes(a)) await gh.dispatch(WORKFLOWS.decide, { action: a, site, request: req });
  else if (a === "onboard") await gh.dispatch(WORKFLOWS.onboard, { site });
  else if (a === "apply") await gh.dispatch(WORKFLOWS.apply, { site, request: req });
  else if (a === "health") await gh.dispatch(WORKFLOWS.health, {});
  else return json({ error: "unknown action" }, 400);
  return json({ ok: true, queued: a });
}

// Read-modify-write a JSON file with optimistic retry (Actions commit to the same repo).
async function mutateJson(gh, p, fn, message) {
  for (let i = 0; i < 3; i++) {
    const data = await gh.getJson(p);
    if (!data) throw Object.assign(new Error("not found: " + p), { status: 404 });
    const out = fn(data);
    if (out instanceof Response) return out;
    try {
      await gh.put(p, b64(JSON.stringify(data, null, 2) + "\n"), message);
      return null;
    } catch (e) {
      if (e.status !== 409) throw e;
    }
  }
  throw Object.assign(new Error("Busy — please try again."), { status: 409 });
}

async function updateSite(gh, b) {
  const id = String(b.id || "");
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return json({ error: "bad site" }, 400);
  const err = await mutateJson(gh, `sites/${id}/site.json`, (s) => {
    if (typeof b.name === "string" && b.name.trim()) s.name = b.name.trim().slice(0, 80);
    if (typeof b.client === "string") s.client = b.client.trim().slice(0, 80);
    if (typeof b.paused === "boolean") s.paused = b.paused;
    if (typeof b.is_staging === "boolean") s.is_staging = b.is_staging;
    if (b.archive === true) s.status = "archived";
    if (b.archive === false && s.status === "archived") s.status = "pending_connect";
  }, `dashboard: update site ${id}`);
  return err || json({ ok: true });
}

const SITE_RE = /^[a-z0-9-]{2,40}$/;
const ASSET_KINDS = ["logo", "guidelines", "image", "font", "other"];
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const hex = (v) => (/^#[0-9a-fA-F]{3,8}$/.test(String(v || "").trim()) ? String(v).trim() : "");

async function saveBrand(gh, b) {
  const id = String(b.id || "");
  if (!SITE_RE.test(id) || !(await gh.sha(`sites/${id}/site.json`))) return json({ error: "bad site" }, 400);
  const brand = {
    colors: { primary: hex(b.primary), secondary: hex(b.secondary), accent: hex(b.accent) },
    fonts: { heading: clip(b.font_heading, 80), body: clip(b.font_body, 80) },
    business: clip(b.business, 1500), audience: clip(b.audience, 1000), tone: clip(b.tone, 1000),
    always_remember: clip(b.always_remember, 4000),
    updated_at: new Date().toISOString(),
  };
  await gh.put(`sites/${id}/brand.json`, b64(JSON.stringify(brand, null, 2) + "\n"), `dashboard: brand for ${id}`);
  return json({ ok: true });
}

async function listAssets(gh, site) {
  if (!SITE_RE.test(site)) return json({ error: "bad site" }, 400);
  const items = await gh.list(`sites/${site}/brand/assets`);
  return json((Array.isArray(items) ? items : []).filter((f) => f.type === "file").map((f) => ({ name: f.name, size: f.size || 0 })));
}

async function uploadAssets(gh, b) {
  const site = String(b.site || "");
  if (!SITE_RE.test(site) || !(await gh.sha(`sites/${site}/site.json`))) return json({ error: "bad site" }, 400);
  const kind = ASSET_KINDS.includes(b.kind) ? b.kind : "other";
  const files = Array.isArray(b.files) ? b.files.slice(0, 10) : [];
  if (!files.length) return json({ error: "Choose at least one file." }, 400);
  if (files.reduce((n, f) => n + (f.data || "").length * 0.75, 0) > MAX_UPLOAD) return json({ error: "Files are larger than 8 MB in total." }, 400);
  for (const f of files) {
    const name = String(f.name || "file").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80) || "file";
    await gh.put(`sites/${site}/brand/assets/${kind}--${name}`, f.data, `dashboard: brand asset for ${site}`);
  }
  return json({ ok: true });
}

async function deleteAsset(gh, b) {
  const site = String(b.site || ""), name = String(b.name || "");
  if (!SITE_RE.test(site) || !/^[A-Za-z0-9._-]{1,100}$/.test(name) || name.includes("..")) return json({ error: "bad request" }, 400);
  await gh.del(`sites/${site}/brand/assets/${name}`, `dashboard: remove brand asset from ${site}`);
  return json({ ok: true });
}

async function updateConfig(gh, b) {
  const err = await mutateJson(gh, "state.json", (st) => {
    const c = st.config;
    if (typeof b.paused === "boolean") c.paused = b.paused;
    if (Number.isFinite(+b.preview_link_ttl_hours)) c.preview_link_ttl_hours = Math.max(1, Math.min(168, +b.preview_link_ttl_hours));
    for (const k of ["performance", "accessibility", "best_practices", "seo"]) {
      if (b.lighthouse_min && Number.isFinite(+b.lighthouse_min[k])) c.qa.lighthouse_min[k] = Math.max(0, Math.min(100, +b.lighthouse_min[k]));
    }
  }, "dashboard: update settings");
  return err || json({ ok: true });
}

async function feedback(gh, b) {
  const id = String(b.request || "");
  const note = String(b.note || "").trim();
  if (!/^R\d{8}-\d{3}$/.test(id) || !note) return json({ error: "Write what should change." }, 400);
  const p = `requests/${id}/feedback.md`;
  const prev = await gh.getRaw(p);
  const old = prev ? await prev.text() : "# Feedback\n";
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  await gh.put(p, b64(`${old}\n## ${stamp} UTC\n${note.slice(0, 5000)}\n`), `dashboard: feedback on ${id}`);
  const err = await mutateJson(gh, "state.json", (st) => {
    const r = st.requests.find((x) => x.id === id);
    if (!r) return json({ error: "Request not found." }, 404);
    r.status = "changes_requested";
    r.revision = (r.revision || 1) + 1;
    r.updated_at = new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
  }, `dashboard: changes requested on ${id}`);
  return err || json({ ok: true });
}

/* ---------------------------------------------------------------- utils */

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- inbox */
// Every incoming change request (Slack, Trello, ClickUp, email, manual) lands in inbox/<id>.json first.
// A site with channels.auto = true turns matching items into requests straight away; otherwise you review them in the Inbox.

const INBOX_SOURCES = ["slack", "trello", "clickup", "email", "chat", "document", "raw", "other"];
const cleanOrigin = (o) => {
  const out = {};
  for (const k of ["source", "url", "from", "channel", "src_channel", "thread_ts", "card", "board", "task", "list", "message_id"]) if (o[k]) out[k] = clip(o[k], 300);
  return out;
};
const strip = (html) => String(html || "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();

async function sha8(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadSites(gh) {
  const dirs = (await gh.list("sites")).filter((d) => d.type === "dir" && !d.name.startsWith("_"));
  return (await Promise.all(dirs.map((d) => gh.getJson(`sites/${d.name}/site.json`)))).filter((s) => s && s.status !== "archived");
}

// Which site does this item belong to? channels: {slack:[ids], trello:[board ids], clickup:[list ids], email:[addresses or @domains], auto:bool}
function resolveSite(sites, item) {
  const text = `${item.title || ""} ${item.text || ""}`.toLowerCase();
  const tag = text.match(/\[([a-z0-9-]{2,40})\]/g) || [];
  for (const t of tag) { const id = t.slice(1, -1); if (sites.some((s) => s.id === id)) return sites.find((s) => s.id === id); }
  const o = item.origin || {};
  return sites.find((s) => {
    const c = s.channels || {};
    if (item.source === "slack") return (c.slack || []).includes(o.src_channel || o.channel);
    if (item.source === "trello") return (c.trello || []).includes(o.board);
    if (item.source === "clickup") return (c.clickup || []).includes(o.list);
    if (item.source === "email") {
      const from = String(item.from || o.from || "").toLowerCase();
      return (c.email || []).some((m) => { m = String(m).toLowerCase(); return m.startsWith("@") ? from.endsWith(m) : from === m; });
    }
    return false;
  });
}

async function inboxAdd(gh, item, sites) {
  const day = (item.created_at || new Date().toISOString()).slice(0, 10).replace(/-/g, "");
  const id = `I${day}-${item.source.slice(0, 2)}-${await sha8(item.external_id || crypto.randomUUID())}`;
  const p = `inbox/${id}.json`;
  if (await gh.sha(p)) return { id, duplicate: true };
  const site = resolveSite(sites || (await loadSites(gh)), item);
  const doc = {
    id, source: item.source, site: site ? site.id : "", title: clip(item.title || item.text, 120), text: clip(item.text, 20000),
    from: clip(item.from, 120), url: clip(item.url, 300), origin: { source: item.source, ...(item.origin || {}), url: item.url || "", from: item.from || "" },
    attachments: [], status: "new", created_at: item.created_at || new Date().toISOString(),
  };
  let total = 0;
  for (const f of (item.files || []).slice(0, 10)) {
    const name = String(f.name || "file").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80) || "file";
    total += (f.data || "").length * 0.75;
    if (total > MAX_UPLOAD) throw bad("Attachments are larger than 8 MB in total.");
    await gh.put(`inbox/${id}/files/${name}`, f.data, `inbox: attachment for ${id}`);
    doc.attachments.push(name);
  }
  await gh.put(p, b64(JSON.stringify(doc, null, 2) + "\n"), `inbox: ${item.source} message ${id}`);
  if (site && site.channels?.auto === true && site.status === "active" && !site.paused) {
    const r = await convertItem(gh, doc, { site: site.id, kind: "change" }).catch(() => null);
    if (r) return { id, request: r.id };
  }
  return { id };
}

async function convertItem(gh, doc, o) {
  const files = [];
  for (const name of doc.attachments || []) {
    const r = await gh.getRaw(`inbox/${doc.id}/files/${name}`);
    if (r) files.push({ name, data: bufB64(await r.arrayBuffer()) });
  }
  const res = await createRequest(gh, {
    site: o.site, kind: o.kind || "change", title: o.title || doc.title, text: doc.text || doc.title, urgent: !!o.urgent,
    source: INBOX_SOURCES.includes(doc.source) ? doc.source : "other", origin: doc.origin, files,
  });
  await mutateJson(gh, `inbox/${doc.id}.json`, (d) => { d.status = "converted"; d.site = o.site; d.request = res.id; }, `inbox: ${doc.id} → ${res.id}`);
  return res;
}

async function inboxList(gh) {
  const names = (await gh.list("inbox")).filter((f) => f.type === "file" && f.name.endsWith(".json")).map((f) => f.name).sort().reverse().slice(0, 60);
  const items = (await Promise.all(names.map((n) => gh.getJson(`inbox/${n}`)))).filter(Boolean);
  items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return json(items);
}

async function inboxManual(gh, b) {
  const text = clip(b.text, 20000);
  const files = Array.isArray(b.files) ? b.files : [];
  if (!text && !files.length) throw bad("Write the change or attach a document.");
  const source = ["chat", "document", "raw"].includes(b.source) ? b.source : files.length && !text ? "document" : "chat";
  const sites = await loadSites(gh);
  const site = SITE_RE.test(String(b.site || "")) ? b.site : "";
  const r = await inboxAdd(gh, { source, title: clip(b.title, 120) || clip(text, 120) || files[0]?.name, text: text || `See attached: ${files.map((f) => f.name).join(", ")}`, from: "dashboard", files, origin: {} }, sites);
  if (site && !r.request) await mutateJson(gh, `inbox/${r.id}.json`, (d) => { d.site = site; }, `inbox: assign ${r.id}`);
  return json({ ok: true, ...r });
}

async function inboxConvert(gh, b) {
  const id = String(b.id || "");
  if (!/^I\d{8}-[a-z]{2}-[0-9a-f]{8}$/.test(id)) throw bad("bad item");
  const doc = await gh.getJson(`inbox/${id}.json`);
  if (!doc) throw bad("Item not found.", 404);
  if (doc.status === "converted") throw bad(`Already turned into ${doc.request}.`, 409);
  const kind = ["change", "new_site", "revamp", "brief", "maintenance"].includes(b.kind) ? b.kind : "change";
  return json({ ok: true, ...(await convertItem(gh, doc, { site: String(b.site || ""), kind, title: clip(b.title, 120), urgent: !!b.urgent })) });
}

async function inboxIgnore(gh, b) {
  const id = String(b.id || "");
  if (!/^I\d{8}-[a-z]{2}-[0-9a-f]{8}$/.test(id)) throw bad("bad item");
  const err = await mutateJson(gh, `inbox/${id}.json`, (d) => { d.status = b.restore ? "new" : "ignored"; }, `inbox: ${id} ${b.restore ? "restored" : "ignored"}`);
  return err || json({ ok: true });
}

async function saveChannels(gh, b) {
  const id = String(b.id || "");
  if (!SITE_RE.test(id)) throw bad("bad site");
  const list = (v) => String(v || "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20).map((x) => x.slice(0, 120));
  const err = await mutateJson(gh, `sites/${id}/site.json`, (s) => {
    s.channels = { ...(s.channels || {}), slack: list(b.slack), trello: list(b.trello), clickup: list(b.clickup), email: list(b.email), auto: !!b.auto };
  }, `dashboard: channels for ${id}`);
  return err || json({ ok: true });
}

/* ---------------------------------------------------------------- webhooks (public, verified by signature or token) */

async function hmacRaw(secret, msg, hash = "SHA-256", out = "hex") {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, typeof msg === "string" ? enc.encode(msg) : msg));
  return out === "hex" ? [...sig].map((b) => b.toString(16).padStart(2, "0")).join("") : btoa(String.fromCharCode(...sig));
}

async function slackVerify(request, raw, secret) {
  const ts = request.headers.get("X-Slack-Request-Timestamp") || "";
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw bad("stale", 401);
  const sig = request.headers.get("X-Slack-Signature") || "";
  if (!(await safeEqual(sig, `v0=${await hmacRaw(secret, `v0:${ts}:${raw}`)}`))) throw bad("bad signature", 401);
}

// "Send to Autopilot" message shortcut: anyone can push any message (also from private chats they are in) into the Inbox.
async function slackAction(gh, env, request, raw) {
  const c = await creds(env, "slack");
  const secret = c.signing_secret || env.SLACK_SIGNING_SECRET;
  if (!secret) throw bad("This channel is not configured on the dashboard.", 503);
  await slackVerify(request, raw, secret);
  let pl = {};
  try { pl = JSON.parse(new URLSearchParams(raw).get("payload") || "{}"); } catch { throw bad("bad payload"); }
  if (pl.type !== "message_action" || pl.callback_id !== "send_to_autopilot") return json({ ok: true });
  const m = pl.message || {};
  const text = clip(m.text, 20000);
  let reply = "Added to the WP Autopilot Inbox.";
  if (!text) reply = "That message has no text to send.";
  else {
    const r = await inboxAdd(gh, {
      source: "slack", external_id: `${pl.channel?.id}:${m.ts}`, text, title: text.split("\n")[0], from: pl.user?.name || pl.user?.id,
      created_at: new Date(Number(m.ts) * 1000).toISOString(), origin: { channel: pl.user?.id, src_channel: pl.channel?.id },
    });
    if (r.duplicate) reply = "That message is already in the Inbox.";
    else if (r.request) reply = `Added and turned into request ${r.request}.`;
  }
  if (/^https:\/\/hooks\.slack\.com\//.test(pl.response_url || "")) {
    await fetch(pl.response_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response_type: "ephemeral", text: reply }), signal: AbortSignal.timeout(8000) }).catch(() => {});
  }
  return json({ ok: true });
}

async function hooks(name, request, env, ctx) {
  if (request.method === "HEAD" || request.method === "GET") return new Response("ok"); // Trello checks the URL with HEAD
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const raw = await request.text();
  if (raw.length > 6 * 1024 * 1024) return json({ error: "too large" }, 413);
  if (name === "slack-action") return slackAction(github(env), env, request, raw);
  let body;
  try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "bad json" }, 400); }
  const need = (v) => { if (!v) throw bad("This channel is not configured on the dashboard.", 503); return v; };
  const gh = github(env);
  if (name === "notify") return hookNotify(gh, env, request, body);
  // Slack's one-time URL check carries no secret yet; echoing the challenge has no side effects.
  if (name === "slack" && body.type === "url_verification") return json({ challenge: body.challenge });
  const c = await creds(env, name === "generic" ? "email" : name);

  if (name === "slack") {
    await slackVerify(request, raw, need(c.signing_secret || env.SLACK_SIGNING_SECRET));
    const ev = body.event || {};
    if (body.type !== "event_callback" || !["message", "app_mention"].includes(ev.type) || ev.bot_id || (ev.subtype && ev.subtype !== "file_share")) return json({ ok: true, ignored: true });
    const text = String(ev.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!text) return json({ ok: true, ignored: true });
    const job = inboxAdd(gh, {
      source: "slack", external_id: `${ev.channel}:${ev.ts}`, text, title: text.split("\n")[0], from: ev.user,
      created_at: new Date(Number(ev.ts) * 1000).toISOString(), origin: { channel: ev.channel, thread_ts: ev.thread_ts || ev.ts },
      url: "",
    });
    if (ctx?.waitUntil) { ctx.waitUntil(job.catch(() => {})); return json({ ok: true }); } // Slack wants a reply within 3 s
    return json({ ok: true, ...(await job) });
  }

  if (name === "trello") {
    const secret = need(c.secret || env.TRELLO_SECRET);
    const callback = new URL(request.url).origin + "/api/hooks/trello";
    const sig = request.headers.get("X-Trello-Webhook") || "";
    if (!(await safeEqual(sig, await hmacRaw(secret, raw + callback, "SHA-1", "b64")))) throw bad("bad signature", 401);
    const a = body.action || {};
    if (!["createCard", "commentCard"].includes(a.type)) return json({ ok: true, ignored: true });
    const card = a.data?.card || {};
    let desc = "";
    const tk = c.key || env.TRELLO_KEY, tt = c.token || env.TRELLO_TOKEN;
    if (a.type === "createCard" && tk && tt) {
      const r = await fetch(`https://api.trello.com/1/cards/${card.id}?fields=desc&key=${tk}&token=${tt}`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (r?.ok) desc = (await r.json()).desc || "";
    }
    const text = a.type === "commentCard" ? `${card.name}\n\n${a.data?.text || ""}` : `${card.name}${desc ? `\n\n${desc}` : ""}`;
    return json({ ok: true, ...(await inboxAdd(gh, {
      source: "trello", external_id: a.id, text, title: card.name, from: a.memberCreator?.fullName || a.memberCreator?.username,
      created_at: a.date, url: card.shortLink ? `https://trello.com/c/${card.shortLink}` : "",
      origin: { card: card.id, board: a.data?.board?.id },
    })) });
  }

  if (name === "clickup") {
    const secrets = [...Object.values(c.webhooks || {}).map((w) => w.secret), env.CLICKUP_WEBHOOK_SECRET].filter(Boolean);
    need(secrets.length);
    const given = request.headers.get("X-Signature") || "";
    let okSig = false;
    for (const sec of secrets) if (await safeEqual(given, await hmacRaw(sec, raw))) okSig = true;
    if (!okSig) throw bad("bad signature", 401);
    if (!["taskCreated", "taskCommentPosted"].includes(body.event) || !body.task_id) return json({ ok: true, ignored: true });
    let task = {};
    if (c.token || env.CLICKUP_TOKEN) {
      const r = await fetch(`https://api.clickup.com/api/v2/task/${body.task_id}`, { headers: { Authorization: c.token || env.CLICKUP_TOKEN }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (r?.ok) task = await r.json();
    }
    const comment = body.event === "taskCommentPosted" ? String(body.history_items?.[0]?.comment?.text_content || "") : "";
    const text = `${task.name || `ClickUp task ${body.task_id}`}${task.description ? `\n\n${task.description}` : ""}${comment ? `\n\nComment: ${comment}` : ""}`;
    return json({ ok: true, ...(await inboxAdd(gh, {
      source: "clickup", external_id: `${body.event}:${body.task_id}:${body.history_items?.[0]?.id || ""}`, text, title: task.name || "ClickUp task",
      from: body.history_items?.[0]?.user?.username, url: task.url || `https://app.clickup.com/t/${body.task_id}`,
      origin: { task: body.task_id, list: task.list?.id },
    })) });
  }

  if (name === "email" || name === "generic") {
    const token = need(c.token || env.INBOX_TOKEN);
    const given = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") || new URL(request.url).searchParams.get("token") || "";
    if (!(await safeEqual(given, token))) throw bad("unauthorized", 401);
    const text = clip(body.text || strip(body.html || body.body || ""), 20000);
    const subject = clip(body.subject, 200);
    if (!text && !subject) throw bad("Empty message.");
    return json({ ok: true, ...(await inboxAdd(gh, {
      source: name === "email" ? "email" : (INBOX_SOURCES.includes(body.source) ? body.source : "other"),
      external_id: body.message_id || `${body.from}:${subject}:${text.slice(0, 200)}`, text: subject ? `${subject}\n\n${text}` : text,
      title: subject || text.split("\n")[0], from: clip(body.from, 120), created_at: body.received_at || undefined,
      origin: { message_id: body.message_id },
      files: (body.attachments || []).map((a) => ({ name: a.name, data: a.content_base64 || a.data })).filter((a) => a.data),
    })) });
  }
  return json({ error: "not found" }, 404);
}

/* ---------------------------------------------------------------- connections (tokens kept encrypted in Workers KV, never in the repo) */

const b64buf = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function aesKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("ap-conn:" + env.SESSION_SECRET));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ iv: bufB64(iv), ct: bufB64(ct) });
}
async function unseal(env, text) {
  if (!text) return null;
  const { iv, ct } = JSON.parse(text);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64buf(iv) }, await aesKey(env), b64buf(ct))));
}
async function creds(env, provider) {
  if (!env.CONNECTIONS) return {};
  try { return (await unseal(env, await env.CONNECTIONS.get("conn:" + provider))) || {}; } catch { return {}; }
}
async function putCreds(env, provider, obj, meta) {
  await env.CONNECTIONS.put("conn:" + provider, await seal(env, obj));
  await env.CONNECTIONS.put("meta:" + provider, JSON.stringify({ ...meta, connected_at: meta.connected_at || new Date().toISOString() }));
}
async function getMeta(env, provider) {
  try { return JSON.parse((await env.CONNECTIONS.get("meta:" + provider)) || "null"); } catch { return null; }
}

const CHANNEL_PROVIDERS = ["slack", "trello", "clickup"];
const ext = async (url, opt = {}) => {
  const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r) throw bad("Could not reach the service. Try again.", 502);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
};
const slackManifest = (origin) => ({
  display_information: { name: "WP Autopilot", description: "Sends website change requests to WP Autopilot" },
  features: { bot_user: { display_name: "WP Autopilot", always_online: false }, app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false } },
  oauth_config: { scopes: { bot: ["app_mentions:read", "channels:history", "channels:join", "channels:read", "chat:write", "groups:history", "groups:read", "im:history"] } },
  settings: { event_subscriptions: { request_url: `${origin}/api/hooks/slack`, bot_events: ["app_mention", "message.channels", "message.groups", "message.im"] },
    interactivity: { is_enabled: true, request_url: `${origin}/api/hooks/slack-action` },
    org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
});

async function connections(sub, request, env, url) {
  const p = sub.split("/").filter(Boolean);
  const gh = github(env);
  const origin = url.origin;
  if (p[0] === undefined && request.method === "GET") return connectionsStatus(gh, env, origin);
  if (request.method !== "POST") return json({ error: "not found" }, 404);
  if (!env.CONNECTIONS) throw bad("Storage is not connected yet — see the notice at the top of this page.", 503);
  const b = await request.json().catch(() => ({}));
  const f = (b.fields && typeof b.fields === "object") ? b.fields : {};
  const val = (k, n = 400) => clip(f[k], n);

  if (p[0] === "save") {
    const prov = String(b.provider || "");
    const old = await creds(env, prov);
    if (prov === "slack") {
      const bot_token = val("bot_token") || old.bot_token, signing_secret = val("signing_secret") || old.signing_secret;
      if (!/^xoxb-/.test(bot_token || "")) throw bad("The Bot token starts with xoxb-.");
      if (!signing_secret) throw bad("Paste the Signing Secret from Basic Information.");
      const r = await ext("https://slack.com/api/auth.test", { method: "POST", headers: { Authorization: `Bearer ${bot_token}` } });
      if (!r.data.ok) throw bad(`Slack refused the token (${r.data.error || r.status}).`);
      await putCreds(env, "slack", { bot_token, signing_secret }, { label: r.data.team || "Slack" });
    } else if (prov === "trello") {
      const key = val("key") || old.key, token = val("token") || old.token, secret = val("secret") || old.secret;
      if (!key || !token || !secret) throw bad("Trello needs the API key, the token and the API secret.");
      const r = await ext(`https://api.trello.com/1/members/me?fields=username&key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`);
      if (!r.ok) throw bad("Trello refused the key or token.");
      await putCreds(env, "trello", { key, token, secret, webhooks: old.webhooks || {} }, { label: r.data.username || "Trello" });
    } else if (prov === "clickup") {
      const token = val("token") || old.token;
      if (!token) throw bad("Paste your ClickUp personal API token.");
      const r = await ext("https://api.clickup.com/api/v2/team", { headers: { Authorization: token } });
      if (!r.ok || !r.data.teams?.length) throw bad("ClickUp refused the token.");
      await putCreds(env, "clickup", { token, team_id: r.data.teams[0].id, webhooks: old.webhooks || {} }, { label: r.data.teams[0].name });
    } else if (prov === "notify") {
      const webhook_url = val("webhook_url", 500), email_flow_url = val("email_flow_url", 500);
      for (const u of [webhook_url, email_flow_url]) if (u && !/^https:\/\/[^\s]+$/.test(u)) throw bad("Addresses must start with https://");
      await putCreds(env, "notify", { webhook_url, email_flow_url }, { label: [webhook_url && "Chat webhook", email_flow_url && "Email flow"].filter(Boolean).join(" + ") || "Nothing set" });
    } else throw bad("unknown provider");
    return json({ ok: true });
  }

  if (p[0] === "disconnect") {
    const prov = String(b.provider || "");
    const c = await creds(env, prov);
    if (prov === "trello") for (const w of Object.values(c.webhooks || {})) await ext(`https://api.trello.com/1/webhooks/${w.id}?key=${c.key}&token=${c.token}`, { method: "DELETE" }).catch(() => {});
    if (prov === "clickup") for (const w of Object.values(c.webhooks || {})) await ext(`https://api.clickup.com/api/v2/webhook/${w.id}`, { method: "DELETE", headers: { Authorization: c.token } }).catch(() => {});
    if (!["slack", "trello", "clickup", "email", "notify"].includes(prov)) throw bad("unknown provider");
    await env.CONNECTIONS.delete("conn:" + prov); await env.CONNECTIONS.delete("meta:" + prov);
    return json({ ok: true });
  }

  if (p[0] === "email") {
    const old = await creds(env, "email");
    if (p[1] === "reveal") return json({ ok: true, token: old.token || "" });
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
    await putCreds(env, "email", { token }, { label: "Token set" });
    return json({ ok: true, token });
  }

  if (p[0] === "choices") {   // channels / boards / lists the connected account can see
    const prov = String(b.provider || "");
    const c = await creds(env, prov);
    if (prov === "slack") {
      const r = await ext("https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200", { headers: { Authorization: `Bearer ${c.bot_token}` } });
      if (!r.data.ok) throw bad(`Slack: ${r.data.error || r.status}`);
      return json((r.data.channels || []).map((x) => ({ id: x.id, name: "#" + x.name, member: !!x.is_member })));
    }
    if (prov === "trello") {
      const r = await ext(`https://api.trello.com/1/members/me/boards?fields=name&filter=open&key=${c.key}&token=${c.token}`);
      if (!r.ok) throw bad("Trello refused the request.");
      return json(r.data.map((x) => ({ id: x.id, name: x.name })));
    }
    if (prov === "clickup") {
      const h = { headers: { Authorization: c.token } };
      const sp = await ext(`https://api.clickup.com/api/v2/team/${c.team_id}/space?archived=false`, h);
      const out = [];
      for (const s of (sp.data.spaces || []).slice(0, 20)) {
        const [fo, li] = await Promise.all([ext(`https://api.clickup.com/api/v2/space/${s.id}/folder?archived=false`, h), ext(`https://api.clickup.com/api/v2/space/${s.id}/list?archived=false`, h)]);
        for (const l of li.data.lists || []) out.push({ id: l.id, name: `${s.name} / ${l.name}` });
        for (const fd of fo.data.folders || []) for (const l of fd.lists || []) out.push({ id: l.id, name: `${s.name} / ${fd.name} / ${l.name}` });
      }
      return json(out);
    }
    throw bad("unknown provider");
  }

  if (p[0] === "watch") {     // create the webhook at Trello / ClickUp and route it to a website
    const prov = String(b.provider || ""), id = clip(b.id, 60), site = String(b.site || "");
    if (!SITE_RE.test(site) || !id) throw bad("Choose the board or list and the website.");
    const c = await creds(env, prov);
    const callback = `${origin}/api/hooks/${prov}`;
    if (prov === "trello") {
      if (!c.webhooks?.[id]) {
        const q = new URLSearchParams({ callbackURL: callback, idModel: id, description: "WP Autopilot", key: c.key, token: c.token });
        const r = await ext(`https://api.trello.com/1/webhooks/?${q}`, { method: "POST" });
        if (!r.ok) throw bad(`Trello could not create the webhook (${r.status}).`);
        c.webhooks = { ...(c.webhooks || {}), [id]: { id: r.data.id } };
        await putCreds(env, "trello", c, (await getMeta(env, "trello")) || {});
      }
    } else if (prov === "clickup") {
      if (!c.webhooks?.[id]) {
        const r = await ext(`https://api.clickup.com/api/v2/team/${c.team_id}/webhook`, { method: "POST", headers: { Authorization: c.token, "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: callback, events: ["taskCreated", "taskCommentPosted"], list_id: Number(id) }) });
        if (!r.ok || !r.data.webhook?.secret) throw bad(`ClickUp could not create the webhook (${r.status}).`);
        c.webhooks = { ...(c.webhooks || {}), [id]: { id: r.data.id, secret: r.data.webhook.secret } };
        await putCreds(env, "clickup", c, (await getMeta(env, "clickup")) || {});
      }
    } else if (prov === "slack") {
      let joined = false;
      if (/^C/.test(id)) {   // public channels: the bot joins itself; private ones need /invite
        const r = await ext("https://slack.com/api/conversations.join", { method: "POST", headers: { Authorization: `Bearer ${c.bot_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ channel: id }) });
        joined = !!r.data.ok;
      }
      const res = await mapChannel(gh, prov, id, site, false);
      return res.status === 200 ? json({ ok: true, joined }) : res;
    } else throw bad("unknown provider");
    return mapChannel(gh, prov, id, site, false);
  }

  if (p[0] === "map") {
    const prov = String(b.provider || ""), id = clip(b.id, 60), site = String(b.site || "");
    if (!CHANNEL_PROVIDERS.includes(prov) || !id || !SITE_RE.test(site)) throw bad("bad request");
    if (b.remove && prov !== "slack") {  // stop watching: remove webhook too when no website uses it any more
      const c = await creds(env, prov);
      const others = (await loadSites(gh)).filter((s) => s.id !== site && (s.channels?.[prov] || []).includes(id));
      const w = c.webhooks?.[id];
      if (w && !others.length) {
        if (prov === "trello") await ext(`https://api.trello.com/1/webhooks/${w.id}?key=${c.key}&token=${c.token}`, { method: "DELETE" }).catch(() => {});
        else await ext(`https://api.clickup.com/api/v2/webhook/${w.id}`, { method: "DELETE", headers: { Authorization: c.token } }).catch(() => {});
        delete c.webhooks[id];
        await putCreds(env, prov, c, (await getMeta(env, prov)) || {});
      }
    }
    return mapChannel(gh, prov, id, site, !!b.remove);
  }
  return json({ error: "not found" }, 404);
}

async function mapChannel(gh, prov, id, site, remove) {
  const err = await mutateJson(gh, `sites/${site}/site.json`, (s) => {
    const c = (s.channels = s.channels || {});
    const set = new Set(c[prov] || []);
    if (remove) set.delete(id); else set.add(id);
    c[prov] = [...set];
  }, `dashboard: ${remove ? "unmap" : "map"} ${prov} ${id} for ${site}`);
  return err || json({ ok: true });
}

async function connectionsStatus(gh, env, origin) {
  const out = { storage: !!env.CONNECTIONS, origin, providers: {} };
  if (env.CONNECTIONS) {
    for (const prov of ["slack", "trello", "clickup", "email", "notify"]) {
      const m = await getMeta(env, prov);
      if (m) out.providers[prov] = { connected: true, label: m.label || "", since: m.connected_at };
    }
    out.slack_manifest = JSON.stringify(slackManifest(origin), null, 2);
  }
  out.legacy = { slack: !!env.SLACK_SIGNING_SECRET, trello: !!env.TRELLO_SECRET, clickup: !!env.CLICKUP_WEBHOOK_SECRET, email: !!env.INBOX_TOKEN };
  return json(out);
}

/* ---------------------------------------------------------------- outbound notices (Actions → dashboard → Slack/Trello/ClickUp/email) */

const NOTICE = {
  needs_info: ["❓", "needs your answers before it can be built"],
  preview_ready: ["👀", "is ready to review — open it in the dashboard to approve or ask for changes"],
  qa_failed: ["⚠️", "failed the automatic checks and was not published"],
  live: ["🚀", "is live"], rolled_back: ["↩️", "was rolled back"], error: ["❌", "hit an error"],
};

// The caller proves it is a workflow run of this repository by presenting that run's own GITHUB_TOKEN; no shared secret is needed.
async function hookNotify(gh, env, request, body) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const runId = String(body.run_id || "");
  if (!token || !/^\d{1,20}$/.test(runId)) throw bad("unauthorized", 401);
  const base = `${env.GITHUB_API || "https://api.github.com"}/repos/${env.GITHUB_REPO}`;
  const v = await fetch(`${base}/actions/runs/${runId}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "wp-autopilot-dashboard" }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  const run = v?.ok ? await v.json() : null;
  if (!run || !["in_progress", "queued"].includes(run.status)) throw bad("unauthorized", 401);
  const rid = String(body.request || ""), event = String(body.event || "");
  if (!/^R\d{8}-\d{3}$/.test(rid) || !NOTICE[event]) throw bad("bad notice");
  return json({ ok: true, sent: await sendNotice(gh, env, rid, event, new URL(request.url).origin) });
}

async function sendNotice(gh, env, rid, event, origin) {
  const st = await gh.getJson("state.json");
  const r = (st?.requests || []).find((x) => x.id === rid);
  if (!r) throw bad("request not found", 404);
  const site = (await gh.getJson(`sites/${r.site}/site.json`)) || {};
  const [icon, phrase] = NOTICE[event];
  const link = `${origin}/#/req/${rid}`;
  let text = `${icon} ${site.name || r.site}: “${r.title || ""}” (${rid}) ${phrase}.${link ? `\n${link}` : ""}`;
  if (event === "needs_info") {
    const q = await gh.getRaw(`requests/${rid}/questions.md`);
    if (q) text += "\n\n" + (await q.text()).slice(0, 900);
  }
  const sent = [];
  const post = async (name, url, data, headers = {}) => {
    const x = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data), signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (x?.ok) sent.push(name);
  };
  const n = await creds(env, "notify");
  if (n.webhook_url) await post("webhook", n.webhook_url, { text, event, site: r.site, request: rid, link });
  const o = r.origin || {};
  const src = o.source || r.source;
  if (src === "slack" && o.channel) {
    const c = await creds(env, "slack");
    if (c.bot_token) await post("slack", "https://slack.com/api/chat.postMessage", { channel: o.channel, thread_ts: o.thread_ts, text }, { Authorization: `Bearer ${c.bot_token}` });
  } else if (src === "trello" && o.card) {
    const c = await creds(env, "trello");
    if (c.key) await post("trello", `https://api.trello.com/1/cards/${o.card}/actions/comments?${new URLSearchParams({ text, key: c.key, token: c.token })}`, {});
  } else if (src === "clickup" && o.task) {
    const c = await creds(env, "clickup");
    if (c.token) await post("clickup", `https://api.clickup.com/api/v2/task/${o.task}/comment`, { comment_text: text }, { Authorization: c.token });
  } else if (src === "email" && o.from && n.email_flow_url) {
    await post("email", n.email_flow_url, { to: o.from, subject: `Re: ${r.title || ""} (${rid})`, body: text });
  }
  return sent;
}
