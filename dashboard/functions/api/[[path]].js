// WP Autopilot dashboard API — Cloudflare Pages Function.
// Env: GITHUB_TOKEN (secret), GITHUB_REPO ("owner/repo"), DASHBOARD_PASSWORD (secret), SESSION_SECRET (secret).
// The GitHub token never reaches the browser; every route except /api/login needs a valid session cookie.

const SESSION_DAYS = 7;
const MAX_UPLOAD = 8 * 1024 * 1024;
const READ_PREFIXES = ["sites/", "reports/", "requests/", "state.json", "docs/"];
const WORKFLOWS = { onboard: "onboard.yml", apply: "apply.yml", health: "health.yml", decide: "decide.yml", urgent: "urgent.yml", reference: "reference.yml" };
const enc = new TextEncoder();

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const path = "/" + [].concat(params.path || []).join("/");
  try {
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
    if (path === "/config" && request.method === "POST") return updateConfig(gh, await request.json());
    if (path === "/requests/feedback" && request.method === "POST") return feedback(gh, await request.json());
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: e.message || String(e) }, e.status || 500);
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
  const site = String(b.site || "");
  const text = String(b.text || "").trim();
  if (!/^[a-z0-9-]{2,40}$/.test(site) || !text) return json({ error: "Choose a site and describe the request." }, 400);
  const kind = ["change", "new_site", "revamp", "brief", "maintenance"].includes(b.kind) ? b.kind : "change";
  const rb = b.reference || {};
  const refUrl = String(rb.url || "").trim();
  if (refUrl && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(refUrl)) return json({ error: "Reference URL must start with http:// or https://" }, 400);
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
      if (total > MAX_UPLOAD) return json({ error: "Attachments are larger than 8 MB in total." }, 400);
      await gh.put(`requests/${id}/attachments/${name}`, f.data, `dashboard: attachment for ${id}`);
      names.push(name);
    }
    const refMd = ref ? `\n\n## Reference\n- url: ${ref.url}\n- mode: ${ref.mode}\n- own_site: ${ref.own ? "yes" : "no"}\n- notes: ${ref.notes || "-"}` : "";
    const md = `---\nid: ${id}\nsite: ${site}\nkind: ${kind}\nsource: dashboard\n---\n\n## Request\n${text}${refMd}\n\n## Attachments\n${
      names.map((n) => `- attachments/${n}`).join("\n") || "- none"
    }\n\n## Acceptance\n${String(b.acceptance || "").trim() || "- (as described above)"}\n`;
    await gh.put(`requests/${id}/request.md`, b64(md), `dashboard: request ${id}`);

    const fresh = await gh.getJson("state.json");
    if (fresh.requests.some((r) => r.id === id)) continue; // id taken meanwhile → retry
    const now = new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
    const urgent = !!b.urgent;
    fresh.requests.push({ id, site, kind, status: "new", source: "dashboard", urgent, ...(ref ? { reference: { url: ref.url, mode: ref.mode } } : {}), title: String(b.title || text).slice(0, 120), created_at: now, updated_at: now });
    try {
      await gh.put("state.json", b64(JSON.stringify(fresh, null, 2) + "\n"), `dashboard: new request ${id}`);
      if (ref) await gh.dispatch(WORKFLOWS.reference, { request: id }).catch(() => {});
      if (urgent) await gh.dispatch(WORKFLOWS.urgent, { request: id }).catch(() => {});
      return json({ ok: true, id, urgent });
    } catch (e) {
      if (e.status !== 409) throw e;
    }
  }
  return json({ error: "Busy — please try again." }, 409);
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
