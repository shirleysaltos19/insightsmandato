// API de Insights de Activación de Mandato
// Guarda la base del mes y las validaciones de supervisores en Netlify Blobs.
import { getStore } from "@netlify/blobs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const okKey = (s) => /^[A-Z0-9-]{1,80}$/.test(s || "");

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "");
  const store = getStore({ name: "mandato", consistency: "strong" });
  const adminKey = Netlify.env.get("ADMIN_KEY");

  try {
    // Comprobación de que la API existe
    if (route === "ping") return json({ ok: true, admin: !!adminKey });

    // Base del mes (comprimida en gzip por la página)
    if (route === "data") {
      if (req.method === "GET") {
        const buf = await store.get("mes", { type: "arrayBuffer" });
        if (!buf) return json({ error: "sin_datos" }, 404);
        return new Response(buf, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
      }
      if (req.method === "PUT") {
        if (!adminKey) return json({ error: "falta_admin_key" }, 500);
        if (req.headers.get("x-admin-key") !== adminKey) return json({ error: "clave_incorrecta" }, 401);
        const body = await req.arrayBuffer();
        if (!body.byteLength) return json({ error: "vacio" }, 400);
        await store.delete("mes");            // se elimina la base anterior
        await store.set("mes", body);
        return json({ ok: true, bytes: body.byteLength, at: new Date().toISOString() });
      }
      return json({ error: "metodo" }, 405);
    }

    // Validaciones: un documento por supervisor y por mes
    if (route === "vals") {
      const mes = url.searchParams.get("mes");
      if (!okKey(mes)) return json({ error: "mes_invalido" }, 400);
      const prefix = `vals/${mes}/`;
      if (req.method === "GET") {
        const { blobs } = await store.list({ prefix });
        const docs = {};
        await Promise.all(blobs.map(async (b) => { const d = await store.get(b.key, { type: "json" }); if (d) docs[b.key.slice(prefix.length)] = d; }));
        return json({ docs });
      }
      if (req.method === "POST") {
        const sup = url.searchParams.get("sup");
        if (!okKey(sup)) return json({ error: "supervisor_invalido" }, 400);
        const patch = await req.json();
        if (!patch || typeof patch !== "object") return json({ error: "cuerpo" }, 400);
        const key = prefix + sup;
        const cur = (await store.get(key, { type: "json" })) || { sup: patch.sup || sup, items: {} };
        const items = { ...(cur.items || {}) };
        for (const [h, v] of Object.entries(patch.items || {})) {
          if (!/^[a-z0-9]{1,24}$/.test(h) || !v || typeof v !== "object") continue;
          items[h] = { ...(items[h] || {}), ...v, nov: String(v.nov ?? items[h]?.nov ?? "").slice(0, 500) };
        }
        const doc = { sup: String(patch.sup || cur.sup).slice(0, 80), items, ...(cur.envio ? { envio: cur.envio } : {}) };
        if (patch.envio && typeof patch.envio === "object") doc.envio = patch.envio;
        doc.updatedAt = new Date().toISOString();
        await store.setJSON(key, doc);
        return json({ ok: true, doc });
      }
      return json({ error: "metodo" }, 405);
    }
    return json({ error: "ruta" }, 404);
  } catch (e) {
    return json({ error: "servidor", detalle: String(e && e.message || e) }, 500);
  }
};

export const config = { path: "/api/*" };
