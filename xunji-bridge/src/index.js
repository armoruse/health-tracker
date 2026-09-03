/**
 * BODY × 訓記 Bridge v2.4.1 (Queue observability and writeback validation)
 */

const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbyygSNrQ5YbEjHIEQq8kIR2UQVepnTKBj4VIcNTkgcwX6ioaAy7cpL7V29IGJtOQ4ui/exec";

import { normalizeCatalog } from "./movement-resolver.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders,
        },
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // 1. Health Check
      if (url.pathname === "/" && request.method === "GET") {
        return json({
          success: true,
          service: "BODY × 訓記 Bridge v2",
          version: "2.4.1",
          modules: {
            training: { read: "POST /training/read", write: "POST /training/write" },
            movements: {
              catalog: "POST /movements/catalog",
              aliases: ["POST /movement/catalog", "POST /xunji/movements"]
            },
            templates: { sync: "POST /templates/sync", mutate: "POST /templates/mutate" },
            food: {
              query: "POST /food/query",
              search: "POST /food/search",
              upsert: "POST /food/upsert"
            },
            body: { query: "POST /body/query", dry_run: "POST /body/dry-run", confirm: "POST /body/confirm" },
            queue: {
              process: "POST /queue/process (or /process)",
              actions: ["TEMPLATE_SYNC", "TEMPLATE_MUTATE", "READ_TRAINING", "WRITE_TRAINING"]
            }
          }
        });
      }

      // 2. Queue Processing Endpoint
      if ((url.pathname === "/queue/process" || url.pathname === "/process") && request.method === "POST") {
        if (env.BODY_QUEUE_SECRET) {
          const authHeader = request.headers.get("Authorization") || "";
          const token = authHeader.replace(/^Bearer\s+/i, "").trim();
          if (token !== env.BODY_QUEUE_SECRET) {
            return json({ success: false, error: "Unauthorized: Invalid BODY_QUEUE_SECRET" }, 401);
          }
        }
        const result = await processQueueInternal(env);
        return json({ success: true, ...result });
      }

      // 3. Training Endpoints
      if (["/movements/catalog", "/movement/catalog", "/xunji/movements"].includes(url.pathname) && request.method === "POST") {
        const apiKey = env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) return json({ success: false, error: "Missing Cloudflare Secret: XUNJI_TRAIN_API_KEY" }, 500);

        let body = {};
        const requestText = await request.text();
        if (requestText.trim()) body = JSON.parse(requestText);

        const upstream = await fetch("https://trains.xunjiapp.cn/api_movement_catalog_for_llm_v2", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body)
        });

        const resText = await upstream.text();
        let resData;
        try { resData = JSON.parse(resText); } catch { resData = { raw: resText }; }
        return json({
          ok: upstream.ok,
          status: upstream.status,
          data: resData,
          normalized: upstream.ok ? normalizeMovementCatalog(resData) : []
        }, upstream.ok ? 200 : upstream.status);
      }

      if ((url.pathname === "/training/read" || url.pathname === "/xunji/read") && request.method === "POST") {
        const apiKey = env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) return json({ success: false, error: "Missing Cloudflare Secret: XUNJI_TRAIN_API_KEY" }, 500);

        const body = await request.json();
        const payload = {
          schema_version: "train_open_api_v2",
          datestr: body.datestr || body.date || getTodayDatestr(),
          include_full_data: body.include_full_data !== false && body.full !== false
        };

        const upstream = await fetch("https://trains.xunjiapp.cn/api_trains_for_llm_v2", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(payload)
        });

        const resText = await upstream.text();
        let resData;
        try { resData = JSON.parse(resText); } catch { resData = { raw: resText }; }
        return json({ ok: upstream.ok, status: upstream.status, data: resData }, upstream.ok ? 200 : upstream.status);
      }

      if ((url.pathname === "/training/write" || url.pathname === "/xunji/write") && request.method === "POST") {
        const apiKey = env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) return json({ success: false, error: "Missing Cloudflare Secret: XUNJI_TRAIN_API_KEY" }, 500);

        const body = await request.json();
        const payload = {
          schema_version: "train_open_api_v2",
          client_request_id: body.client_request_id || crypto.randomUUID(),
          dry_run: body.dry_run === true,
          include_full_data: body.include_full_data !== false,
          res: body.res || body.trains || []
        };

        const upstream = await fetch("https://trains.xunjiapp.cn/api_upsert_trains_for_llm_v2", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(payload)
        });

        const resText = await upstream.text();
        let resData;
        try { resData = JSON.parse(resText); } catch { resData = { raw: resText }; }
        return json({ ok: upstream.ok, status: upstream.status, data: resData }, upstream.ok ? 200 : upstream.status);
      }

      // 4. Template Endpoints (Fixed routes)
      if (url.pathname === "/templates/sync" && request.method === "POST") {
        const apiKey = env.XUNJI_TEMPLATE_API_KEY || env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) return json({ success: false, error: "Missing Cloudflare Secret: XUNJI_TEMPLATE_API_KEY" }, 500);

        const body = await request.json();
        const payload = {
          cursor: Number(body.cursor) || 0,
          limit: 15,
          include_content: body.include_content !== false
        };

        const upstream = await fetch("https://trains.xunjiapp.cn/api_agent_templates_sync_for_llm_v1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(payload)
        });

        const resText = await upstream.text();
        let resData;
        try { resData = JSON.parse(resText); } catch { resData = { raw: resText }; }
        return json({ ok: upstream.ok, status: upstream.status, data: resData }, upstream.ok ? 200 : upstream.status);
      }

      if (url.pathname === "/templates/mutate" && request.method === "POST") {
        const apiKey = env.XUNJI_TEMPLATE_API_KEY || env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) return json({ success: false, error: "Missing Cloudflare Secret: XUNJI_TEMPLATE_API_KEY" }, 500);

        const body = await request.json();
        if (body.confirmed !== true) {
          return json({ success: false, error: "confirmed: true is required for mutate" }, 400);
        }

        const payload = {
          mutation_id: body.mutation_id || crypto.randomUUID(),
          confirmed: true,
          folder_update: body.folder_update,
          upserts: body.upserts || [],
          deletes: body.deletes || []
        };

        const upstream = await fetch("https://trains.xunjiapp.cn/api_agent_templates_mutate_for_llm_v1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(payload)
        });

        const resText = await upstream.text();
        let resData;
        try { resData = JSON.parse(resText); } catch { resData = { raw: resText }; }
        return json({ ok: upstream.ok, status: upstream.status, data: resData }, upstream.ok ? 200 : upstream.status);
      }

      // 5. Food Endpoints
      if (url.pathname === "/food/query" && request.method === "POST") {
        const apiKey = env.XUNJI_FOOD_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) return json({ success: false, error: "Missing Cloudflare Secret: XUNJI_FOOD_API_KEY" }, 500);

        const body = await request.json();
        const upstream = await fetch("https://trains.xunjiapp.cn/api_food_query_for_llm", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body)
        });
        const resText = await upstream.text();
        let resData;
        try { resData = JSON.parse(resText); } catch { resData = { raw: resText }; }
        return json({ ok: upstream.ok, status: upstream.status, data: resData }, upstream.ok ? 200 : upstream.status);
      }

      // 6. Body Endpoints
      if (url.pathname.startsWith("/body/") && request.method === "POST") {
        const apiKey = env.XUNJI_BODY_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) return json({ success: false, error: "Missing Cloudflare Secret: XUNJI_BODY_API_KEY" }, 500);

        const body = await request.json();
        let targetPath = "api_body_query_for_llm";
        if (url.pathname === "/body/dry-run") targetPath = "api_body_dry_run_for_llm";
        if (url.pathname === "/body/confirm") targetPath = "api_body_confirm_for_llm";

        const upstream = await fetch(`https://trains.xunjiapp.cn/${targetPath}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body)
        });
        const resText = await upstream.text();
        let resData;
        try { resData = JSON.parse(resText); } catch { resData = { raw: resText }; }
        return json({ ok: upstream.ok, status: upstream.status, data: resData }, upstream.ok ? 200 : upstream.status);
      }

      return json({ success: false, error: "Endpoint Not Found" }, 404);
    } catch (err) {
      return json({ success: false, error: err?.message || String(err) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    logInfo("cron_triggered", {
      triggeredAt: new Date(event?.scheduledTime || Date.now()).toISOString(),
      cron: event?.cron || "unknown"
    });
    ctx.waitUntil(
      (async () => {
        try {
          const res = await processQueueInternal(env);
          logInfo("cron_finished", res);
        } catch (cronErr) {
          logError("cron_failed", { error: getErrorMessage(cronErr) });
        }
      })()
    );
  }
};

async function processQueueInternal(env) {
  const gasUrl = (env.GAS_WEB_APP_URL || DEFAULT_GAS_URL).trim();
  const fetchUrl = `${gasUrl}?action=queue_pending&limit=5`;
  const gasRes = await fetch(fetchUrl, { method: "GET" });
  logInfo("queue_pending_response", { httpStatus: gasRes.status, httpOk: gasRes.ok });

  let gasData;
  try {
    gasData = await gasRes.json();
  } catch {
    throw new Error(`Failed to parse queue_pending response from GAS (${gasRes.status})`);
  }
  if (!gasRes.ok) throw new Error(`Failed to read queue from GAS (${gasRes.status})`);
  if (!gasData || !gasData.ok) throw new Error(`GAS queue_pending returned error: ${gasData?.error || "Unknown"}`);
  if (!Array.isArray(gasData.items)) throw new Error("GAS queue_pending returned invalid items format");

  const pendingItems = gasData.items;
  logInfo("queue_pending_items", { count: pendingItems.length });
  if (pendingItems.length === 0) {
    const result = { processed: 0, successCount: 0, errorCount: 0, message: "No pending tasks found in XunjiQueue" };
    logInfo("queue_processing_summary", result);
    return result;
  }

  let successCount = 0;
  let errorCount = 0;
  const processResults = [];

  for (const item of pendingItems) {
    const rowIndex = item.rowIndex;
    const action = String(item.action || "").trim();
    const targetDate = String(item.targetDate || "").trim();
    const targetId = String(item.targetId || "").trim();
    const rawPayload = item.payloadJson;
    const isConfirmed = isTrue(item.confirmed);
    const logContext = { rowIndex, action, targetDate, targetId };
    logInfo("queue_item_started", logContext);

    const nowIso = new Date().toISOString();
    let finalStatus = "error";
    let resultJson = "";
    let errorMessage = "";
    let templateId = targetId || "";
    let cursorVal = "";

    try {
      await postQueueState(gasUrl, { action: "queue_processing", rowIndex }, "queue_processing_write", logContext);

      let payload = {};
      if (typeof rawPayload === "string" && rawPayload.trim()) {
        try { payload = JSON.parse(rawPayload); } catch (pe) { throw new Error(`Invalid PayloadJson: ${pe.message}`); }
      } else if (typeof rawPayload === "object" && rawPayload !== null) {
        payload = rawPayload;
      }

      if (action === "TEMPLATE_SYNC") {
        const apiKey = env.XUNJI_TEMPLATE_API_KEY || env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
        const upstream = await fetch("https://trains.xunjiapp.cn/api_agent_templates_sync_for_llm_v1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            cursor: payload.cursor !== undefined ? payload.cursor : 0,
            limit: 15,
            include_content: payload.include_content !== false
          })
        });
        logUpstreamResponse(logContext, upstream);
        const resData = await upstream.json().catch(() => ({}));
        resultJson = JSON.stringify(resData);
        if (upstream.ok && resData.ok) {
          finalStatus = "success";
          cursorVal = String(resData.data?.next_cursor ?? resData.next_cursor ?? "");
        } else {
          finalStatus = "error";
          errorMessage = resData.error || resData.data?.res || "Template sync failed";
        }
      } else if (action === "TEMPLATE_MUTATE") {
        if (!isConfirmed) {
          finalStatus = "waiting_confirmation";
          errorMessage = "user confirmation required";
        } else {
          const apiKey = env.XUNJI_TEMPLATE_API_KEY || env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
          const upstream = await fetch("https://trains.xunjiapp.cn/api_agent_templates_mutate_for_llm_v1", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              mutation_id: payload.mutation_id || crypto.randomUUID(),
              confirmed: true,
              ...payload
            })
          });
          logUpstreamResponse(logContext, upstream);
          const resData = await upstream.json().catch(() => ({}));
          resultJson = JSON.stringify(resData);
          if (upstream.ok && resData.ok && resData.data?.success !== false) {
            finalStatus = "success";
            cursorVal = String(resData.data?.next_cursor ?? "");
            const appliedTpl = resData.data?.applied?.[0]?.template_id;
            if (appliedTpl) templateId = String(appliedTpl);
          } else {
            finalStatus = "error";
            errorMessage = resData.error || resData.data?.res || "Template mutate failed";
          }
        }
      } else if (action === "READ_TRAINING") {
        const apiKey = env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) throw new Error("Missing Cloudflare Secret: XUNJI_TRAIN_API_KEY");
        const upstream = await fetch("https://trains.xunjiapp.cn/api_trains_for_llm_v2", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            schema_version: "train_open_api_v2",
            datestr: payload.datestr || targetDate || getTodayDatestr(),
            include_full_data: payload.include_full_data !== false
          })
        });
        logUpstreamResponse(logContext, upstream);
        const resData = await upstream.json().catch(() => ({}));
        resultJson = JSON.stringify(resData);
        if (upstream.ok && (resData.ok === true || Array.isArray(resData.res?.trains))) {
          finalStatus = "success";
        } else {
          finalStatus = "error";
          errorMessage = resData.error || resData.data?.res || "Read training failed";
        }
      } else if (action === "WRITE_TRAINING" || action === "UPSERT_TRAINING") {
        if (!isConfirmed) {
          finalStatus = "waiting_confirmation";
          errorMessage = "user confirmation required";
        } else {
          const apiKey = env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
          if (!apiKey) throw new Error("Missing Cloudflare Secret: XUNJI_TRAIN_API_KEY");

          const trains = payload.res || payload.trains || [];
          if (!Array.isArray(trains) || trains.length === 0) {
            throw new Error("WRITE_TRAINING requires a non-empty payload.res or payload.trains array");
          }

          const upstream = await fetch("https://trains.xunjiapp.cn/api_upsert_trains_for_llm_v2", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              schema_version: "train_open_api_v2",
              client_request_id: payload.client_request_id || `body-queue-${rowIndex}`,
              dry_run: payload.dry_run === true,
              include_full_data: payload.include_full_data !== false,
              res: trains
            })
          });
          logUpstreamResponse(logContext, upstream);
          const resData = await upstream.json().catch(() => ({}));
          resultJson = JSON.stringify(resData);
          if (upstream.ok && resData.ok !== false && resData.data?.success !== false) {
            finalStatus = "success";
          } else {
            finalStatus = "error";
            errorMessage = resData.error || resData.data?.res || "Write training failed";
          }
        }
      } else {
        finalStatus = "error";
        errorMessage = `Unsupported Action: ${action}`;
      }
    } catch (taskErr) {
      finalStatus = "error";
      errorMessage = getErrorMessage(taskErr);
      logError("queue_item_failed", { ...logContext, error: errorMessage });
    }

    let writebackOk = false;
    try {
      await postQueueState(gasUrl, {
        action: "queue_update",
        rowIndex,
        status: finalStatus,
        processedAt: nowIso,
        resultJson,
        errorMessage,
        templateId,
        cursor: cursorVal
      }, "queue_result_write", logContext);
      writebackOk = true;
    } catch (updErr) {
      logError("queue_result_write_failed", { ...logContext, error: getErrorMessage(updErr) });
    }

    if (finalStatus === "success" && writebackOk) successCount++; else errorCount++;
    processResults.push({ rowIndex, action, status: finalStatus, writebackOk });
  }

  const result = { processed: pendingItems.length, successCount, errorCount, results: processResults };
  logInfo("queue_processing_summary", result);
  return result;
}

async function postQueueState(gasUrl, payload, event, context) {
  const response = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  const result = {
    ...context,
    httpStatus: response.status,
    httpOk: response.ok,
    gasOk: data?.ok === true,
    status: data?.status || ""
  };
  logInfo(event, result);

  if (!response.ok || data?.ok !== true) {
    throw new Error(`${payload.action} write failed (${response.status}): ${data?.error || "Invalid GAS response"}`);
  }
  return data;
}

function logUpstreamResponse(context, response) {
  logInfo("xunji_upstream_response", {
    ...context,
    httpStatus: response.status,
    httpOk: response.ok
  });
}

function logInfo(event, details = {}) {
  console.log(JSON.stringify({ event, ...details }));
}

function logError(event, details = {}) {
  console.error(JSON.stringify({ event, ...details }));
}

function getErrorMessage(error) {
  return error?.message || String(error);
}

function isTrue(val) {
  if (val === true) return true;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  if (typeof val === "number") return val === 1;
  return false;
}

function getTodayDatestr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const normalizeMovementCatalog = normalizeCatalog;
