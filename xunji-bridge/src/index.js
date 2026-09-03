/**
 * BODY × 訓記 Bridge v2.5.1 (ChatGPT Actions-compatible OpenAPI)
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
      if (url.pathname === "/openapi.json" && request.method === "GET") {
        return json(buildOpenApiSpec(url.origin));
      }

      if (url.pathname === "/privacy" && request.method === "GET") {
        return new Response(
          "BODY × 訓記 Bridge relays authenticated requests to the user's Xunji account. " +
          "It does not place API keys or complete private health payloads in application logs.",
          { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders } }
        );
      }

      const conversationOperation = getConversationOperation(url.pathname);
      if (conversationOperation) {
        if (!env.BODY_QUEUE_SECRET) {
          return json({ success: false, error: "Conversation API is not configured" }, 503);
        }
        const authHeader = request.headers.get("Authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (!token || !(await secretsEqual(token, env.BODY_QUEUE_SECRET))) {
          return json({ success: false, error: "Unauthorized" }, 401);
        }
        logInfo("conversation_request", { operation: conversationOperation });
      }

      // 1. Health Check
      if (url.pathname === "/" && request.method === "GET") {
        return json({
          success: true,
          service: "BODY × 訓記 Bridge v2",
          version: "2.5.1",
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
            },
            conversation: {
              schema: "GET /openapi.json",
              auth: "Bearer BODY_QUEUE_SECRET",
              read: "POST /conversation/training/read",
              write: "POST /conversation/training/write"
            }
          }
        });
      }

      // 2. Queue Processing Endpoint
      if ((url.pathname === "/queue/process" || url.pathname === "/process") && request.method === "POST") {
        if (env.BODY_QUEUE_SECRET) {
          const authHeader = request.headers.get("Authorization") || "";
          const token = authHeader.replace(/^Bearer\s+/i, "").trim();
          if (!token || !(await secretsEqual(token, env.BODY_QUEUE_SECRET))) {
            return json({ success: false, error: "Unauthorized: Invalid BODY_QUEUE_SECRET" }, 401);
          }
        }
        const result = await processQueueInternal(env);
        return json({ success: true, ...result });
      }

      // 3. Training Endpoints
      if (["/movements/catalog", "/movement/catalog", "/xunji/movements", "/conversation/movements/catalog"].includes(url.pathname) && request.method === "POST") {
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
        if (conversationOperation) logInfo("conversation_response", { operation: conversationOperation, httpStatus: upstream.status, httpOk: upstream.ok });
        return json({
          ok: upstream.ok,
          status: upstream.status,
          data: resData,
          normalized: upstream.ok ? normalizeMovementCatalog(resData) : []
        }, upstream.ok ? 200 : upstream.status);
      }

      if (["/training/read", "/xunji/read", "/conversation/training/read"].includes(url.pathname) && request.method === "POST") {
        const apiKey = env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) return json({ success: false, error: "Missing Cloudflare Secret: XUNJI_TRAIN_API_KEY" }, 500);

        const body = await request.json();
        if (conversationOperation && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.datestr || ""))) {
          return json({ success: false, error: "datestr is required in YYYY-MM-DD format" }, 400);
        }
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
        if (conversationOperation) logInfo("conversation_response", { operation: conversationOperation, httpStatus: upstream.status, httpOk: upstream.ok });
        return json({ ok: upstream.ok, status: upstream.status, data: resData }, upstream.ok ? 200 : upstream.status);
      }

      if (["/training/write", "/xunji/write", "/conversation/training/write"].includes(url.pathname) && request.method === "POST") {
        const apiKey = env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) return json({ success: false, error: "Missing Cloudflare Secret: XUNJI_TRAIN_API_KEY" }, 500);

        const body = await request.json();
        if (conversationOperation && body.confirmed !== true) {
          return json({ success: false, error: "Explicit current-turn confirmation is required" }, 400);
        }
        if (conversationOperation && !String(body.client_request_id || "").trim()) {
          return json({ success: false, error: "client_request_id is required for idempotent writes" }, 400);
        }
        const trains = body.res || body.trains || [];
        if (!Array.isArray(trains) || trains.length === 0) {
          return json({ success: false, error: "A non-empty res or trains array is required" }, 400);
        }
        const payload = {
          schema_version: "train_open_api_v2",
          client_request_id: body.client_request_id || crypto.randomUUID(),
          dry_run: body.dry_run === true,
          include_full_data: body.include_full_data !== false,
          res: trains
        };

        const upstream = await fetch("https://trains.xunjiapp.cn/api_upsert_trains_for_llm_v2", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(payload)
        });

        const resText = await upstream.text();
        let resData;
        try { resData = JSON.parse(resText); } catch { resData = { raw: resText }; }
        if (conversationOperation) logInfo("conversation_response", { operation: conversationOperation, httpStatus: upstream.status, httpOk: upstream.ok });
        return json({ ok: upstream.ok, status: upstream.status, data: resData }, upstream.ok ? 200 : upstream.status);
      }

      // 4. Template Endpoints (Fixed routes)
      if (["/templates/sync", "/conversation/templates/sync"].includes(url.pathname) && request.method === "POST") {
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
        if (conversationOperation) logInfo("conversation_response", { operation: conversationOperation, httpStatus: upstream.status, httpOk: upstream.ok });
        return json({ ok: upstream.ok, status: upstream.status, data: resData }, upstream.ok ? 200 : upstream.status);
      }

      if (["/templates/mutate", "/conversation/templates/mutate"].includes(url.pathname) && request.method === "POST") {
        const apiKey = env.XUNJI_TEMPLATE_API_KEY || env.XUNJI_TRAIN_API_KEY || env.XUNJI_API_KEY;
        if (!apiKey) return json({ success: false, error: "Missing Cloudflare Secret: XUNJI_TEMPLATE_API_KEY" }, 500);

        const body = await request.json();
        if (body.confirmed !== true) {
          return json({ success: false, error: "confirmed: true is required for mutate" }, 400);
        }
        if (conversationOperation && !String(body.mutation_id || "").trim()) {
          return json({ success: false, error: "mutation_id is required for idempotent mutations" }, 400);
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
        if (conversationOperation) logInfo("conversation_response", { operation: conversationOperation, httpStatus: upstream.status, httpOk: upstream.ok });
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

function getConversationOperation(pathname) {
  const routes = {
    "/conversation/movements/catalog": "listMovements",
    "/conversation/training/read": "readTraining",
    "/conversation/training/write": "writeTraining",
    "/conversation/templates/sync": "readTemplates",
    "/conversation/templates/mutate": "modifyTemplates"
  };
  return routes[pathname] || "";
}

async function secretsEqual(provided, expected) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

function buildOpenApiSpec(origin) {
  const jsonRequest = schema => ({
    required: true,
    content: { "application/json": { schema } }
  });
  const responseRef = (description, schemaName) => ({
    description,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schemaName}` }
      }
    }
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "BODY Xunji Conversation API",
      version: "2.5.1",
      description: "Authenticated read and explicitly confirmed write access to the user's Xunji training data.",
      license: { name: "Private use only", url: `${origin}/privacy` }
    },
    servers: [{ url: origin }],
    paths: {
      "/conversation/movements/catalog": {
        post: {
          operationId: "listMovements",
          summary: "List canonical Xunji movements before drafting training changes",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest({ $ref: "#/components/schemas/MovementCatalogRequest" }),
          responses: {
            "200": responseRef("Movement catalog response", "BridgeResponse"),
            "401": responseRef("Unauthorized", "ErrorResponse")
          }
        }
      },
      "/conversation/training/read": {
        post: {
          operationId: "readTraining",
          summary: "Read training records for one explicit Asia/Taipei calendar date",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest({ $ref: "#/components/schemas/TrainingReadRequest" }),
          responses: {
            "200": responseRef("Training read response", "BridgeResponse"),
            "400": responseRef("Invalid request", "ErrorResponse"),
            "401": responseRef("Unauthorized", "ErrorResponse")
          }
        }
      },
      "/conversation/training/write": {
        post: {
          operationId: "writeTraining",
          summary: "Write training only after the user explicitly confirms the exact change in the current conversation turn",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest({ $ref: "#/components/schemas/TrainingWriteRequest" }),
          responses: {
            "200": responseRef("Training write response", "BridgeResponse"),
            "400": responseRef("Confirmation or request validation failed", "ErrorResponse"),
            "401": responseRef("Unauthorized", "ErrorResponse")
          }
        }
      },
      "/conversation/templates/sync": {
        post: {
          operationId: "readTemplates",
          summary: "Read current Xunji templates and revisions",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest({ $ref: "#/components/schemas/TemplateSyncRequest" }),
          responses: {
            "200": responseRef("Template sync response", "BridgeResponse"),
            "401": responseRef("Unauthorized", "ErrorResponse")
          }
        }
      },
      "/conversation/templates/mutate": {
        post: {
          operationId: "modifyTemplates",
          summary: "Modify templates only after the user explicitly confirms the exact change in the current conversation turn",
          security: [{ bearerAuth: [] }],
          requestBody: jsonRequest({ $ref: "#/components/schemas/TemplateMutationRequest" }),
          responses: {
            "200": responseRef("Template mutation response", "BridgeResponse"),
            "400": responseRef("Confirmation or request validation failed", "ErrorResponse"),
            "401": responseRef("Unauthorized", "ErrorResponse")
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" }
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["success", "error"],
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string" }
          },
          additionalProperties: false
        },
        BridgeResponse: {
          type: "object",
          required: ["ok", "status", "data"],
          properties: {
            ok: { type: "boolean" },
            status: { type: "integer", format: "int32" },
            data: { $ref: "#/components/schemas/BridgeData" },
            normalized: {
              type: "array",
              items: { $ref: "#/components/schemas/Movement" }
            }
          },
          additionalProperties: true
        },
        BridgeData: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
            current_revision: { type: "integer", format: "int64" },
            next_cursor: { type: "integer", format: "int64" },
            trains: {
              type: "array",
              items: { $ref: "#/components/schemas/TrainingDay" }
            },
            movements: {
              type: "array",
              items: { $ref: "#/components/schemas/Movement" }
            },
            changes: {
              type: "array",
              items: { $ref: "#/components/schemas/TemplateChange" }
            },
            applied: {
              type: "array",
              items: { $ref: "#/components/schemas/AppliedMutation" }
            },
            res: { $ref: "#/components/schemas/ResultData" },
            data: { $ref: "#/components/schemas/ResultData" }
          },
          additionalProperties: true
        },
        ResultData: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
            trains: {
              type: "array",
              items: { $ref: "#/components/schemas/TrainingDay" }
            },
            movements: {
              type: "array",
              items: { $ref: "#/components/schemas/Movement" }
            },
            next_cursor: { type: "integer", format: "int64" }
          },
          additionalProperties: true
        },
        MovementCatalogRequest: {
          type: "object",
          properties: {
            query: { type: "string", description: "Optional movement name filter" },
            include_aliases: { type: "boolean", default: true }
          },
          additionalProperties: true
        },
        Movement: {
          type: "object",
          required: ["name"],
          properties: {
            identity: { type: "string" },
            identity_field: { type: "string" },
            native_identity_available: { type: "boolean" },
            official_name: { type: "string" },
            name: { type: "string" },
            label: { type: "string" },
            aliases: { type: "array", items: { type: "string" } },
            equipment: { type: "string" },
            muscle: { type: "string" },
            category: { type: "string" },
            movement_type: { type: "string" }
          },
          additionalProperties: true
        },
        TrainingReadRequest: {
          type: "object",
          required: ["datestr"],
          properties: {
            datestr: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              description: "YYYY-MM-DD in Asia/Taipei"
            },
            include_full_data: { type: "boolean", default: true }
          },
          additionalProperties: false
        },
        TrainingWriteRequest: {
          type: "object",
          required: ["confirmed", "client_request_id", "res"],
          properties: {
            confirmed: { type: "boolean", enum: [true], description: "Must be true after explicit current-turn user confirmation" },
            client_request_id: { type: "string", minLength: 8, description: "Stable ID reused for retries of this exact write" },
            dry_run: { type: "boolean", default: false },
            include_full_data: { type: "boolean", default: true },
            res: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/components/schemas/TrainingDay" }
            }
          },
          additionalProperties: false
        },
        TrainingDay: {
          type: "object",
          required: ["datestr"],
          properties: {
            datestr: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            title: { type: "string" },
            movements: {
              type: "array",
              items: { $ref: "#/components/schemas/TrainingMovement" }
            }
          },
          additionalProperties: true
        },
        TrainingMovement: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            label: { type: "string" },
            key: { type: "string" },
            movement_key: { type: "string" },
            sets: {
              type: "array",
              items: { $ref: "#/components/schemas/TrainingSet" }
            }
          },
          additionalProperties: true
        },
        TrainingSet: {
          type: "object",
          properties: {
            weight: { type: "string" },
            weight_kg: { type: "number", format: "double" },
            reps: { type: "string" },
            unit: { type: "string" },
            time: { type: "integer", format: "int32" },
            duration_s: { type: "integer", format: "int32" },
            comment: { type: "string" },
            completed: { type: "boolean" }
          },
          additionalProperties: true
        },
        TemplateSyncRequest: {
          type: "object",
          properties: {
            cursor: { type: "integer", minimum: 0, default: 0 },
            include_content: { type: "boolean", default: true }
          },
          additionalProperties: false
        },
        TemplateMutationRequest: {
          type: "object",
          required: ["confirmed", "mutation_id"],
          properties: {
            confirmed: { type: "boolean", enum: [true], description: "Must be true after explicit current-turn user confirmation" },
            mutation_id: { type: "string", minLength: 8, description: "Stable ID reused for retries of this exact mutation" },
            folder_update: { $ref: "#/components/schemas/TemplateFolderUpdate" },
            upserts: {
              type: "array",
              items: { $ref: "#/components/schemas/TemplateUpsert" }
            },
            deletes: {
              type: "array",
              items: { $ref: "#/components/schemas/TemplateDelete" }
            }
          },
          additionalProperties: false
        },
        TemplateFolderUpdate: {
          type: "object",
          properties: {
            folder_id: { type: "string" },
            name: { type: "string" },
            base_version: { type: "integer", format: "int64" }
          },
          additionalProperties: true
        },
        TemplateUpsert: {
          type: "object",
          required: ["template_id", "name"],
          properties: {
            template_id: { type: "string" },
            base_version: { type: "integer", format: "int64" },
            name: { type: "string" },
            color: { type: "string" },
            movements: {
              type: "array",
              items: { $ref: "#/components/schemas/TrainingMovement" }
            },
            movement: {
              type: "array",
              items: { $ref: "#/components/schemas/TrainingMovement" }
            },
            rules: { $ref: "#/components/schemas/TemplateRules" }
          },
          additionalProperties: true
        },
        TemplateRules: {
          type: "object",
          properties: {
            note: { type: "string" },
            description: { type: "string" }
          },
          additionalProperties: true
        },
        TemplateDelete: {
          type: "object",
          required: ["template_id"],
          properties: {
            template_id: { type: "string" },
            base_version: { type: "integer", format: "int64" }
          },
          additionalProperties: true
        },
        TemplateChange: {
          type: "object",
          properties: {
            entity_type: { type: "string" },
            entity_id: { type: "string" },
            operation: { type: "string" },
            data: { $ref: "#/components/schemas/TemplateUpsert" }
          },
          additionalProperties: true
        },
        AppliedMutation: {
          type: "object",
          properties: {
            template_id: { type: "string" },
            operation: { type: "string" },
            success: { type: "boolean" }
          },
          additionalProperties: true
        }
      }
    }
  };
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
