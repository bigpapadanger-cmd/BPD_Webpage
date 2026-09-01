// ============================================================
// BPD GAMING NETWORK
// OCR MATCH - INTERNAL STORAGE SERVICE
// ============================================================
import {
    putMatchImage,
    putMatchReport
} from "./storage.js";

const STORE_MATCH_VERSION =
    "ocr-store-match-2.0";
const DEFAULT_BENCHMARK_PREFIX =
    "ocr-benchmarks";

// ============================================================
// JSON RESPONSE
// ============================================================
function jsonResponse(
    body,
    status = 200
) {
    return new Response(
        JSON.stringify(body),
        {
            status,
            headers: {
                "Content-Type":
                    "application/json",
                "Cache-Control":
                    "no-store"
            }
        }
    );
}

// ============================================================
// TIMING
// ============================================================
function nowMilliseconds() {
    return performance.now();
}

function elapsedSeconds(
    startedAt
) {
    return Number(
        (
            (
                performance.now()
                - startedAt
            )
            / 1000
        ).toFixed(4)
    );
}

// ============================================================
// AUTH
// ============================================================
function getBearerToken(
    request
) {
    const authorization =
        String(
            request.headers.get(
                "Authorization"
            )
            || ""
        ).trim();
    if (
        !authorization.startsWith(
            "Bearer "
        )
    ) {
        return "";
    }
    return authorization
        .slice(7)
        .trim();
}

function constantTimeEqual(
    first,
    second
) {
    const a =
        new TextEncoder().encode(
            String(first || "")
        );
    const b =
        new TextEncoder().encode(
            String(second || "")
        );
    if (
        a.length
        !== b.length
    ) {
        return false;
    }
    let result = 0;
    for (
        let index = 0;
        index < a.length;
        index += 1
    ) {
        result |=
            a[index]
            ^ b[index];
    }
    return result === 0;
}

function validateInternalRequest(
    request,
    env
) {
    const expectedToken =
        String(
            env.OCR_STORAGE_TOKEN
            || ""
        ).trim();
    if (!expectedToken) {
        return {
            valid: false,
            status: 503,
            reason:
                "OCR storage authentication is not configured."
        };
    }
    const receivedToken =
        getBearerToken(request);
    if (
        !receivedToken
        || !constantTimeEqual(
            receivedToken,
            expectedToken
        )
    ) {
        return {
            valid: false,
            status: 401,
            reason:
                "Unauthorized."
        };
    }
    return {
        valid: true
    };
}

// ============================================================
// ID NORMALIZATION
// ============================================================
function normalizeId(
    value
) {
    return String(
        value || ""
    )
        .trim()
        .toUpperCase();
}

function validId(
    value
) {
    return /^[A-Z0-9]{16}$/.test(
        value
    );
}

// ============================================================
// JSON PARSING
// ============================================================
function parseJsonObject(
    rawValue
) {
    if (
        rawValue === null
        || typeof rawValue
            === "undefined"
    ) {
        return null;
    }
    if (
        typeof rawValue
            === "object"
        && typeof rawValue.arrayBuffer
            !== "function"
    ) {
        return (
            Array.isArray(rawValue)
            ? null
            : rawValue
        );
    }
    try {
        const parsed =
            JSON.parse(
                String(rawValue)
            );
        if (
            parsed
            && typeof parsed
                === "object"
            && !Array.isArray(
                parsed
            )
        ) {
            return parsed;
        }
    } catch {
        return null;
    }
    return null;
}

// ============================================================
// BENCHMARK PREFIX
// ============================================================
function normalizeBenchmarkPrefix(
    value
) {
    const raw =
        String(
            value
            || DEFAULT_BENCHMARK_PREFIX
        )
            .trim()
            .replace(
                /^\/+|\/+$/g,
                ""
            );
    if (!raw) {
        return DEFAULT_BENCHMARK_PREFIX;
    }
    const segments =
        raw
            .split("/")
            .filter(Boolean);
    const valid =
        segments.every(
            segment =>
                /^[a-zA-Z0-9_-]+$/.test(
                    segment
                )
        );
    return (
        valid
        ? segments.join("/")
        : DEFAULT_BENCHMARK_PREFIX
    );
}

// ============================================================
// BENCHMARK STORAGE
// ============================================================
async function putBenchmarkReport(
    bucket,
    {
        jobId,
        benchmark,
        prefix
    }
) {
    const objectKey =
        `${prefix}/${jobId}.json`;
    await bucket.put(
        objectKey,
        JSON.stringify(
            benchmark,
            null,
            2
        ),
        {
            httpMetadata: {
                contentType:
                    "application/json"
            },
            customMetadata: {
                jobId,
                matchId:
                    String(
                        benchmark.matchId
                        || ""
                    ),
                status:
                    String(
                        benchmark.status
                        || ""
                    ),
                serverVersion:
                    String(
                        benchmark.serverVersion
                        || ""
                    )
            }
        }
    );
    return {
        success: true,
        objectKey
    };
}

// ============================================================
// MAIN STORE-MATCH HANDLER
// ============================================================
export async function handleStoreMatch(
    request,
    env
) {
    const handlerStartedAt =
        nowMilliseconds();
    try {
        // ====================================================
        // METHOD
        // ====================================================
        if (
            request.method
            !== "POST"
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Method not allowed."
                },
                405
            );
        }

        // ====================================================
        // AUTH
        // ====================================================
        const authentication =
            validateInternalRequest(
                request,
                env
            );
        if (
            !authentication.valid
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        authentication.reason
                },
                authentication.status
            );
        }

        // ====================================================
        // R2
        // ====================================================
        if (!env.OCR_STORAGE) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR_STORAGE R2 binding is unavailable."
                },
                503
            );
        }

        // ====================================================
        // MULTIPART
        // ====================================================
        const formStartedAt =
            nowMilliseconds();
        const formData =
            await request.formData();
        const formSeconds =
            elapsedSeconds(
                formStartedAt
            );
        const image =
            formData.get(
                "image"
            );
        const matchId =
            normalizeId(
                formData.get(
                    "matchId"
                )
            );
        const jobId =
            normalizeId(
                formData.get(
                    "jobId"
                )
            );
        const matchReport =
            parseJsonObject(
                formData.get(
                    "matchReport"
                )
            );
        const benchmarkReport =
            parseJsonObject(
                formData.get(
                    "benchmarkReport"
                )
            );
        const benchmarkPrefix =
            normalizeBenchmarkPrefix(
                formData.get(
                    "benchmarkPrefix"
                )
            );

        // ====================================================
        // VALIDATION
        // ====================================================
        if (!validId(matchId)) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "matchId must be a 16-character alphanumeric ID."
                },
                400
            );
        }
        if (
            jobId
            && !validId(jobId)
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "jobId must be a 16-character alphanumeric ID."
                },
                400
            );
        }
        if (
            !image
            || typeof image.arrayBuffer
                !== "function"
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Match image is required."
                },
                400
            );
        }
        if (!matchReport) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "matchReport must contain valid JSON."
                },
                400
            );
        }
        if (
            matchReport.matchId
            && normalizeId(
                matchReport.matchId
            ) !== matchId
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "matchReport.matchId does not match matchId."
                },
                400
            );
        }
        if (
            benchmarkReport
            && !jobId
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "jobId is required when benchmarkReport is provided."
                },
                400
            );
        }
        if (
            benchmarkReport?.jobId
            && normalizeId(
                benchmarkReport.jobId
            ) !== jobId
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "benchmarkReport.jobId does not match jobId."
                },
                400
            );
        }
        if (
            benchmarkReport?.matchId
            && normalizeId(
                benchmarkReport.matchId
            ) !== matchId
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "benchmarkReport.matchId does not match matchId."
                },
                400
            );
        }

        // ====================================================
        // IMAGE BYTES
        // ====================================================
        const imageReadStartedAt =
            nowMilliseconds();
        const imageBytes =
            await image.arrayBuffer();
        const imageReadSeconds =
            elapsedSeconds(
                imageReadStartedAt
            );
        if (
            !imageBytes
            || imageBytes.byteLength
                === 0
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Match image is empty."
                },
                400
            );
        }
        const contentType =
            String(
                image.type
                || "image/png"
            );

        // ====================================================
        // STORE IMAGE
        // ====================================================
        const imageWriteStartedAt =
            nowMilliseconds();
        const imageResult =
            await putMatchImage(
                env.OCR_STORAGE,
                {
                    matchId,
                    image:
                        imageBytes,
                    contentType,
                    metadata: {
                        submittedBy:
                            matchReport.submittedBy
                            || "",
                        matchType:
                            matchReport.matchType
                            || "",
                        matchSeason:
                            matchReport.matchSeason
                            || "",
                        ocrVersion:
                            matchReport.ocrVersion
                            || ""
                    }
                }
            );
        const imageWriteSeconds =
            elapsedSeconds(
                imageWriteStartedAt
            );

        // ====================================================
        // STORE REPORT
        // ====================================================
        const reportWriteStartedAt =
            nowMilliseconds();
        const reportResult =
            await putMatchReport(
                env.OCR_STORAGE,
                {
                    matchId,
                    report:
                        matchReport
                }
            );
        const reportWriteSeconds =
            elapsedSeconds(
                reportWriteStartedAt
            );

        // ====================================================
        // STORE BENCHMARK
        // ====================================================
        let benchmarkResult = null;
        let benchmarkWriteSeconds = 0;
        if (
            benchmarkReport
            && jobId
        ) {
            const benchmarkWriteStartedAt =
                nowMilliseconds();
            const benchmark = {
                ...benchmarkReport,
                jobId,
                matchId,
                cloudflareStorage: {
                    version:
                        STORE_MATCH_VERSION,
                    formParseSeconds:
                        formSeconds,
                    imageReadSeconds,
                    imageWriteSeconds,
                    reportWriteSeconds,
                    benchmarkPrefix,
                    imageKey:
                        imageResult.objectKey,
                    reportKey:
                        reportResult.objectKey,
                    preBenchmarkWriteSeconds:
                        elapsedSeconds(
                            handlerStartedAt
                        )
                }
            };
            benchmarkResult =
                await putBenchmarkReport(
                    env.OCR_STORAGE,
                    {
                        jobId,
                        benchmark,
                        prefix:
                            benchmarkPrefix
                    }
                );
            benchmarkWriteSeconds =
                elapsedSeconds(
                    benchmarkWriteStartedAt
                );
        }

        // ====================================================
        // SUCCESS
        // ====================================================
        return jsonResponse(
            {
                success: true,
                stored: true,
                matchId,
                jobId:
                    jobId || null,
                imageKey:
                    imageResult.objectKey,
                reportKey:
                    reportResult.objectKey,
                benchmarkKey:
                    benchmarkResult
                    ?.objectKey
                    || null,
                storagePerformance: {
                    formParseSeconds:
                        formSeconds,
                    imageReadSeconds,
                    imageWriteSeconds,
                    reportWriteSeconds,
                    benchmarkWriteSeconds,
                    totalSeconds:
                        elapsedSeconds(
                            handlerStartedAt
                        )
                },
                version:
                    STORE_MATCH_VERSION
            },
            200
        );
    } catch (error) {
        return jsonResponse(
            {
                success: false,
                message:
                    "Match storage failed.",
                error:
                    String(
                        error?.message
                        || error
                    ),
                runtimeSeconds:
                    elapsedSeconds(
                        handlerStartedAt
                    ),
                version:
                    STORE_MATCH_VERSION
            },
            500
        );
    }
}