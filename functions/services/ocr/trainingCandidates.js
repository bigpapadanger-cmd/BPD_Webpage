"use strict";

const CANDIDATE_PREFIX = "ocr-training-candidates";
const MAX_CANDIDATE_COUNT = 64;
const MAX_CROP_BYTES = 512 * 1024;
const MAX_SINGLE_CROP_BYTES = 64 * 1024;

function normalizeJobId(value) {
    const jobId = String(value || "").trim().toUpperCase();
    return /^[A-Z0-9]{16}$/.test(jobId) ? jobId : "";
}

function getCandidateJobPrefix(jobId, createdAt) {
    const normalizedJobId = normalizeJobId(jobId);
    const date = new Date(createdAt);
    if (!normalizedJobId || !Number.isFinite(date.getTime())) {
        throw new Error("A valid OCR job ID and creation timestamp are required.");
    }
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${CANDIDATE_PREFIX}/${year}/${month}/${day}/${normalizedJobId}`;
}

function decodeCandidateCrop(value) {
    const encoded = String(value || "");
    if (!encoded || encoded.length > MAX_SINGLE_CROP_BYTES * 2) return null;
    try {
        const binary = atob(encoded);
        if (binary.length === 0 || binary.length > MAX_SINGLE_CROP_BYTES) return null;
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
        return bytes;
    } catch {
        return null;
    }
}

function safeCandidate(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const candidateId = String(candidate.candidateId || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(candidateId)) return null;
    const crop = decodeCandidateCrop(candidate.cropPngBase64);
    if (!crop) return null;
    return { candidateId, crop, data: candidate };
}

function imageExtension(contentType, bytes) {
    const normalized = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
    if (normalized === "image/png") return "png";
    if (normalized === "image/jpeg") return "jpg";
    if (normalized === "image/webp") return "webp";
    const view = new Uint8Array(bytes);
    if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) return "png";
    if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return "jpg";
    if (String.fromCharCode(...view.slice(0, 4)) === "RIFF" && String.fromCharCode(...view.slice(8, 12)) === "WEBP") return "webp";
    return null;
}

function candidateMetadata(candidate, { jobId, createdAt, sourceImageKey, archivedSourceImageKey }) {
    const data = candidate.data;
    return {
        schemaVersion: 1,
        candidateId: candidate.candidateId,
        jobId,
        createdAt,
        sourceImageKey,
        archivedSourceImageKey,
        field: String(data.field || "unknown").slice(0, 64),
        team: Number.isInteger(data.team) ? data.team : null,
        teamPlayerIndex: Number.isInteger(data.teamPlayerIndex) ? data.teamPlayerIndex : null,
        sequenceIndex: Number.isInteger(data.sequenceIndex) ? data.sequenceIndex : null,
        componentBox: data.componentBox && typeof data.componentBox === "object" ? data.componentBox : null,
        cellBox: data.cellBox && typeof data.cellBox === "object" ? data.cellBox : null,
        normalizedComponentBox: data.normalizedComponentBox && typeof data.normalizedComponentBox === "object" ? data.normalizedComponentBox : null,
        normalizedCellBox: data.normalizedCellBox && typeof data.normalizedCellBox === "object" ? data.normalizedCellBox : null,
        coordinateSpace: String(data.coordinateSpace || "original_screenshot"),
        prediction: data.prediction && typeof data.prediction === "object" ? data.prediction : null,
        legacyResult: data.legacyResult ?? null,
        finalValue: data.finalValue ?? null,
        engine: String(data.engine || "unknown").slice(0, 64),
        requiresVerification: data.requiresVerification === true,
        fallbackReason: data.fallbackReason ? String(data.fallbackReason).slice(0, 512) : null,
        modelVersion: data.modelVersion ? String(data.modelVersion).slice(0, 128) : null,
        modelSha256: /^[a-f0-9]{64}$/i.test(String(data.modelSha256 || "")) ? data.modelSha256 : null,
        segmentationUnusual: data.segmentationUnusual === true,
        priorityBucket: /^P[1-5]$/.test(String(data.priorityBucket || "")) ? data.priorityBucket : null,
        priorityReasons: Array.isArray(data.priorityReasons) ? data.priorityReasons.slice(0, 8) : [],
        suspiciousGeometry: data.suspiciousGeometry === true,
        approvalStatus: "pending_review",
        approvedLabel: null
    };
}

async function putJson(bucket, key, value) {
    await bucket.put(key, JSON.stringify(value, null, 2), {
        httpMetadata: { contentType: "application/json; charset=utf-8" }
    });
}

export async function persistOcrCandidateArchive({
    bucket,
    jobId: jobIdValue,
    createdAt: createdAtValue,
    sourceImage,
    sourceContentType,
    originalSourceImageKey,
    canonicalResult,
    candidateArchive
}) {
    const jobId = normalizeJobId(jobIdValue);
    const createdAt = new Date(createdAtValue).toISOString();
    const prefix = getCandidateJobPrefix(jobId, createdAt);
    const rawCandidates = Array.isArray(candidateArchive?.candidates) ? candidateArchive.candidates : [];
    const candidateCountFound = Math.max(
        rawCandidates.length,
        Number.isSafeInteger(candidateArchive?.candidateCountFound)
            ? candidateArchive.candidateCountFound
            : rawCandidates.length
    );
    if (!bucket || !jobId || !sourceImage || candidateCountFound === 0) {
        return { saved: false, reason: "no_candidates_or_storage" };
    }

    const sourceBytes = sourceImage instanceof ArrayBuffer
        ? sourceImage
        : await new Response(sourceImage).arrayBuffer();
    const extension = imageExtension(sourceContentType, sourceBytes);
    if (!extension || sourceBytes.byteLength > 10 * 1024 * 1024) {
        return { saved: false, reason: "source_image_invalid_or_oversized" };
    }

    const accepted = [];
    let cropBytes = 0;
    let invalidCandidateCount = 0;
    for (const item of rawCandidates.slice(0, MAX_CANDIDATE_COUNT)) {
        const candidate = safeCandidate(item);
        if (!candidate || cropBytes + candidate.crop.byteLength > MAX_CROP_BYTES) {
            invalidCandidateCount += 1;
            continue;
        }
        cropBytes += candidate.crop.byteLength;
        accepted.push(candidate);
    }
    const sourceImageKey = String(originalSourceImageKey || `ocr-jobs/${jobId}/input.png`);
    const archivedSourceImageKey = `${prefix}/source/scoreboard.${extension}`;
    const timestamp = createdAt;
    const metadataRows = accepted.map(candidate => candidateMetadata(candidate, {
        jobId,
        createdAt: timestamp,
        sourceImageKey,
        archivedSourceImageKey
    }));
    const candidateCountDropped = Math.max(
        candidateCountFound - metadataRows.length,
        rawCandidates.length - metadataRows.length
    );
    const priorityBreakdown = {};
    for (const bucket of ["P1", "P2", "P3", "P4", "P5"]) {
        const sourceCounts = candidateArchive.priorityBreakdown?.[bucket] || {};
        const found = Number.isSafeInteger(sourceCounts.found)
            ? Math.max(0, sourceCounts.found)
            : rawCandidates.filter(item => item?.priorityBucket === bucket).length;
        const saved = metadataRows.filter(row => row.priorityBucket === bucket).length;
        priorityBreakdown[bucket] = {
            found,
            saved,
            dropped: Math.max(0, found - saved)
        };
    }
    const truncated = candidateArchive.truncated === true || candidateCountDropped > 0;
    const manifest = {
        schemaVersion: 1,
        jobId,
        createdAt: timestamp,
        modelVersion: candidateArchive.modelMetadata?.modelVersion || metadataRows.find(item => item.modelVersion)?.modelVersion || null,
        sourceImageKey,
        archivedSourceImageKey,
        candidateCount: metadataRows.length,
        candidateCountFound,
        candidateCountSaved: metadataRows.length,
        candidateCountDropped,
        candidateCap: Number.isSafeInteger(candidateArchive.candidateCap)
            ? candidateArchive.candidateCap
            : MAX_CANDIDATE_COUNT,
        candidateByteCap: Number.isSafeInteger(candidateArchive.candidateByteCap)
            ? candidateArchive.candidateByteCap
            : MAX_CROP_BYTES,
        priorityBreakdown,
        truncationReasons: candidateArchive.truncationReasons || {},
        invalidCandidateCount,
        truncated,
        candidates: metadataRows.map(metadata => ({
            candidateId: metadata.candidateId,
            field: metadata.field,
            team: metadata.team,
            prediction: metadata.prediction?.digit ?? null,
            finalValue: metadata.finalValue,
            requiresVerification: metadata.requiresVerification,
            priorityBucket: metadata.priorityBucket,
            priorityReasons: metadata.priorityReasons,
            approvalStatus: metadata.approvalStatus,
            approvedLabel: null,
            cropKey: `${prefix}/candidates/pending/${metadata.candidateId}/crop.png`,
            metadataKey: `${prefix}/candidates/pending/${metadata.candidateId}/metadata.json`
        }))
    };

    await bucket.put(archivedSourceImageKey, sourceBytes, {
        httpMetadata: { contentType: `image/${extension === "jpg" ? "jpeg" : extension}` },
        customMetadata: { jobId, sourceImageKey }
    });
    await putJson(bucket, `${prefix}/result/canonical_result.json`, canonicalResult || {});
    await putJson(bucket, `${prefix}/result/diagnostics.json`, {
        schemaVersion: 1,
        jobId,
        createdAt: timestamp,
        modelMetadata: candidateArchive.modelMetadata || null,
        coordinateTransform: candidateArchive.coordinateTransform || null,
        saveAllEnabled: candidateArchive.saveAllEnabled === true,
        candidateCountFound,
        candidateCountSaved: metadataRows.length,
        candidateCountDropped,
        candidateCap: manifest.candidateCap,
        candidateByteCap: manifest.candidateByteCap,
        priorityBreakdown,
        truncationReasons: manifest.truncationReasons,
        truncated: manifest.truncated,
        invalidCandidateCount,
        candidates: metadataRows
    });
    if (candidateArchive.modelMetadata) {
        await putJson(bucket, `${prefix}/model/model_metadata.json`, candidateArchive.modelMetadata);
    }
    for (const [index, candidate] of accepted.entries()) {
        const metadata = metadataRows[index];
        const candidatePrefix = `${prefix}/candidates/pending/${candidate.candidateId}`;
        await bucket.put(`${candidatePrefix}/crop.png`, candidate.crop, {
            httpMetadata: { contentType: "image/png" },
            customMetadata: { jobId, candidateId: candidate.candidateId, approvalStatus: "pending_review" }
        });
        await putJson(bucket, `${candidatePrefix}/metadata.json`, metadata);
    }
    await putJson(bucket, `${prefix}/candidates/manifest.json`, manifest);
    return {
        saved: true,
        candidateCount: accepted.length,
        prefix,
        manifestKey: `${prefix}/candidates/manifest.json`,
        sourceImageKey: archivedSourceImageKey,
        truncated: manifest.truncated
    };
}

export { CANDIDATE_PREFIX, MAX_CANDIDATE_COUNT, MAX_CROP_BYTES, getCandidateJobPrefix };
