"use strict";
import { authorizeRequest } from "../auth/authorization.js";
import { listUsers, parseListInput } from "../admin/user_management.js";
import { readJsonBody } from "../http/json.js";
import { fetchBoundedResponse, withUpstreamDeadline } from "../http/upstream.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["pending", "approved", "answered", "duplicate", "rejected"]);
const ACTIONS = new Set(["approve", "answer", "duplicate", "reject", "publish"]);
const RPCS = new Set(["list_published_faqs", "submit_faq_question", "admin_list_faq_questions", "admin_review_faq_question"]);
const ERRORS = {
    ACCOUNT_REQUIRED: 401, IDEMPOTENCY_KEY_REQUIRED: 400, FAQ_QUESTION_REQUIRED: 400, FAQ_QUESTION_TOO_LONG: 400,
    IDEMPOTENCY_KEY_CONFLICT: 409, FAQ_SUBMISSION_FORBIDDEN: 403, FAQ_SUBMISSION_RATE_LIMITED: 429,
    ACTOR_ACCOUNT_REQUIRED: 401, FAQ_REVIEW_FORBIDDEN: 403, INVALID_FAQ_QUESTION_STATUS: 400,
    FAQ_QUESTION_ID_REQUIRED: 400, INVALID_FAQ_REVIEW_ACTION: 400, EXPECTED_REVISION_REQUIRED: 400,
    FAQ_REVIEW_NOTE_TOO_LONG: 400, FAQ_ANSWER_TOO_LONG: 400, FAQ_QUESTION_NOT_FOUND: 404,
    FAQ_QUESTION_REVISION_CONFLICT: 409, FAQ_QUESTION_CANNOT_BE_APPROVED: 409,
    FAQ_QUESTION_MUST_BE_APPROVED_FIRST: 409, FAQ_ANSWER_REQUIRED: 400,
    FAQ_QUESTION_CANNOT_BE_MARKED_DUPLICATE: 409, DUPLICATE_FAQ_REQUIRED: 400, DUPLICATE_FAQ_NOT_FOUND: 404,
    FAQ_QUESTION_CANNOT_BE_REJECTED: 409, FAQ_QUESTION_MUST_BE_ANSWERED_FIRST: 409,
    FAQ_DRAFT_NOT_FOUND: 404, FAQ_ALREADY_PUBLISHED: 409
};
const record = value => value && typeof value === "object" && !Array.isArray(value);
const timestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const nullableId = value => value === null || UUID.test(value || "");
function fail(code = "FAQ_RESPONSE_INVALID", status = 503) { throw Object.assign(new Error(code), { code, status }); }
function requireShape(condition) { if (!condition) fail(); }

async function rpc(env, name, args, normalize, fetcher = fetch) {
    if (!RPCS.has(name)) fail("FAQ_UNAVAILABLE");
    const base = typeof env.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "") : "";
    const key = (typeof env.SUPABASE_SERVICE_ROLE_KEY === "string" ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : "")
        || (typeof env.SUPABASE_AUTH === "string" ? env.SUPABASE_AUTH.trim() : "");
    if (!base || !key) {
        console.warn("FAQ RPC unavailable.", { rpc: name, stage: "configuration" });
        fail("FAQ_UNAVAILABLE");
    }
    try { if (new URL(base).protocol !== "https:") fail("FAQ_UNAVAILABLE"); } catch { fail("FAQ_UNAVAILABLE"); }
    return withUpstreamDeadline(async signal => {
        const response = await fetchBoundedResponse(`${base}/rest/v1/rpc/${name}`, {
            method: "POST", signal, redirect: "error", headers: { apikey: key, Authorization: `Bearer ${key}`,
                "Content-Type": "application/json", "Content-Profile": "api", "Accept-Profile": "api" },
            body: JSON.stringify(args)
        }, 2 * 1024 * 1024, fetcher);
        const body = await response.json();
        if (!response.ok) {
            console.warn("FAQ RPC unavailable.", { rpc: name, stage: "upstream", status: response.status,
                code: ["PGRST202", "PGRST301", "42501", "42883"].includes(body?.code) ? body.code : "UPSTREAM_REJECTED" });
            const code = [body?.message, body?.code, body?.error].find(value => Object.hasOwn(ERRORS, value || ""));
            fail(code || "FAQ_UNAVAILABLE", ERRORS[code] || 503);
        }
        requireShape(record(body) && body.success === true && timestamp(body.capturedAt));
        return normalize(body);
    });
}

function publicList(body) {
    requireShape(Array.isArray(body.faqs));
    return { success: true, capturedAt: body.capturedAt, faqs: body.faqs.map(row => {
        requireShape(record(row) && UUID.test(row.id || "") && text(row.question, 500) && text(row.answer, 10000)
            && timestamp(row.updatedAt) && (!Object.hasOwn(row, "publication_state") || row.publication_state === "published")
            && (!Object.hasOwn(row, "publicationState") || row.publicationState === "published"));
        return { id: row.id, question: row.question, answer: row.answer, updatedAt: row.updatedAt };
    }) };
}
function reviewResult(body) {
    const row = body.question;
    requireShape(record(row) && UUID.test(row.id || "") && STATUSES.has(row.status)
        && Number.isSafeInteger(row.revision) && row.revision >= 1 && ACTIONS.has(body.action)
        && nullableId(row.publishedFaqId) && nullableId(row.duplicateFaqId));
    return { success: true, question: { id: row.id, status: row.status, revision: row.revision,
        publishedFaqId: row.publishedFaqId, duplicateFaqId: row.duplicateFaqId }, action: body.action, capturedAt: body.capturedAt };
}
function adminList(body) {
    requireShape(Array.isArray(body.rows) && body.rows.length <= 30 && Number.isSafeInteger(body.total) && body.total >= 0
        && Number.isSafeInteger(body.page) && body.page >= 1 && body.pageSize === 30 && typeof body.hasMore === "boolean");
    return { success: true, rows: body.rows.map(row => {
        requireShape(record(row) && UUID.test(row.id || "") && text(row.question, 500) && STATUSES.has(row.status)
            && Number.isSafeInteger(row.revision) && row.revision >= 1 && timestamp(row.createdAt) && timestamp(row.updatedAt)
            && nullableId(row.duplicateFaqId) && nullableId(row.publishedFaqId)
            && (row.submitterDisplayName === null || typeof row.submitterDisplayName === "string"));
        // Deliberately omit submitterAccountId and normalized/private database fields.
        return { id: row.id, question: row.question, status: row.status, revision: row.revision,
            submitterDisplayName: row.submitterDisplayName, duplicateFaqId: row.duplicateFaqId,
            publishedFaqId: row.publishedFaqId, createdAt: row.createdAt, updatedAt: row.updatedAt };
    }), total: body.total, page: body.page, pageSize: body.pageSize, hasMore: body.hasMore, capturedAt: body.capturedAt };
}

async function input(request, allowed) {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") fail("ORIGIN_NOT_ALLOWED", 403);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") fail("FAQ_INPUT_INVALID", 415);
    const result = await readJsonBody(request, 65000);
    if (!result.success) fail("FAQ_INPUT_INVALID", result.tooLarge ? 413 : 400);
    if (Object.keys(result.data).some(key => !allowed.includes(key))) fail("FAQ_INPUT_INVALID", 400);
    return result.data;
}
function json(body, status = 200) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function errorResponse(error) {
    const code = error?.code === "USER_MANAGEMENT_FORBIDDEN" ? "FAQ_REVIEW_FORBIDDEN"
        : error?.status === 401 ? "AUTHENTICATION_REQUIRED" : error?.code;
    const trusted = Object.hasOwn(ERRORS, code || "") || ["FAQ_INPUT_INVALID", "ORIGIN_NOT_ALLOWED", "AUTHENTICATION_REQUIRED",
        "ACCOUNT_SUSPENDED", "ACCOUNT_ACCESS_RESTRICTED", "FAQ_RESPONSE_INVALID"].includes(code);
    const safeCode = trusted ? code : "FAQ_UNAVAILABLE";
    const status = trusted ? ([400, 401, 403, 404, 409, 413, 415, 429, 503].includes(error.status) ? error.status : 503) : 503;
    const message = status === 429 ? "You have reached the question limit. Please try again later."
        : safeCode === "FAQ_QUESTION_REVISION_CONFLICT" ? "This question changed. Reload before reviewing it."
            : status === 401 ? "Sign in to ask a question."
                : status === 403 ? "Your account cannot perform this action."
                    : status >= 500 ? "FAQ services are temporarily unavailable. Please retry."
                        : "Check the question or review action and try again.";
    return json({ success: false, error: safeCode, message }, status);
}

export async function handleFaq(request, env, operation, questionId = null, dependencies = {}) {
    const auth = dependencies.authorize || authorizeRequest;
    const fetcher = dependencies.fetcher || fetch;
    const permissions = dependencies.permissions || (async () => {
        const value = await listUsers(request, env, await parseListInput(new URL("/api/admin/user-management", request.url).href));
        return { canReview: ["owner", "admin"].includes(value.permissions.role) };
    });
    const expectedMethod = operation === "submit" || operation === "review" ? "POST" : "GET";
    if (request.method !== expectedMethod) return json({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
    try {
        if (operation === "public") return json(await rpc(env, "list_published_faqs", {}, publicList, fetcher));
        const authorization = await auth(request, env, { account: true, action: ["submit", "review"].includes(operation) ? "post" : "view_account" });
        if (!UUID.test(authorization?.accountId || "")) fail("AUTHENTICATION_REQUIRED", 401);
        if (operation === "submit") {
            const body = await input(request, ["question", "idempotencyKey"]);
            if (!text(body.question, 500) || !UUID.test(body.idempotencyKey || "")) fail("FAQ_INPUT_INVALID", 400);
            return json(await rpc(env, "submit_faq_question", { p_account_id: authorization.accountId,
                p_question: body.question.trim(), p_idempotency_key: body.idempotencyKey }, value => {
                const row = value.question;
                requireShape(record(row) && UUID.test(row.id || "") && STATUSES.has(row.status) && timestamp(row.createdAt) && typeof row.reused === "boolean");
                return { success: true, question: { id: row.id, status: row.status, createdAt: row.createdAt, reused: row.reused }, capturedAt: value.capturedAt };
            }, fetcher));
        }
        if (operation === "list") {
            const params = new URL(request.url).searchParams;
            if ([...params.keys()].some(key => !["status", "page"].includes(key))) fail("FAQ_INPUT_INVALID", 400);
            const status = params.get("status") || "pending", page = Number(params.get("page") || 1);
            if ((!STATUSES.has(status) && status !== "all") || !Number.isSafeInteger(page) || page < 1 || page > 100000) fail("FAQ_INPUT_INVALID", 400);
            const access = await permissions();
            const result = await rpc(env, "admin_list_faq_questions", { p_actor_account_id: authorization.accountId,
                p_status: status, p_page: page, p_page_size: 30 }, adminList, fetcher);
            return json({ ...result, permissions: { canReview: access.canReview === true } });
        }
        if (operation !== "review" || !UUID.test(questionId || "")) fail("FAQ_INPUT_INVALID", 400);
        const body = await input(request, ["action", "answer", "duplicateFaqId", "reviewNote", "expectedRevision"]);
        if (!ACTIONS.has(body.action) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1
            || (body.answer !== undefined && body.answer !== null && (typeof body.answer !== "string" || body.answer.length > 10000))
            || (body.reviewNote !== undefined && body.reviewNote !== null && (typeof body.reviewNote !== "string" || body.reviewNote.length > 4000))
            || (body.duplicateFaqId !== undefined && !nullableId(body.duplicateFaqId))) fail("FAQ_INPUT_INVALID", 400);
        if (body.action === "answer" && !text(body.answer, 10000)) fail("FAQ_ANSWER_REQUIRED", 400);
        if (body.action === "duplicate" && !UUID.test(body.duplicateFaqId || "")) fail("DUPLICATE_FAQ_REQUIRED", 400);
        return json(await rpc(env, "admin_review_faq_question", { p_actor_account_id: authorization.accountId,
            p_question_id: questionId, p_action: body.action, p_answer: body.answer?.trim() || null,
            p_duplicate_faq_id: body.duplicateFaqId || null, p_review_note: body.reviewNote?.trim() || null,
            p_expected_revision: body.expectedRevision }, reviewResult, fetcher));
    } catch (error) { return errorResponse(error); }
}
