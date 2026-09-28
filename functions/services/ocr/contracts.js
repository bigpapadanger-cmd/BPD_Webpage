"use strict";

// ============================================================
// BPD GAMING NETWORK
// OCR SHARED CONTRACT
// ============================================================

export const OCR_CONTRACT_VERSION = "ocr-contract-3.1";

export const OCR_ROSTER_LIMITS = Object.freeze({
    minimumPlayersPerTeam: 1,
    maximumPlayersPerTeam: 16,
    symmetricTeams: true
});

export const OCR_SOURCE_MODES = Object.freeze({
    AUTOMATIC: "automatic",
    MANUAL: "manual"
});

export const OCR_IMAGE_SOURCE_MODES = Object.freeze({
    ORIGINAL_IMAGE: "original_image",
    MANUAL_CROP_RETRY: "manual_crop_retry"
});

export const OCR_COLUMN_SEMANTICS = Object.freeze({
    PLAYER_NAME: "player_name",
    PLAYER_SCORE: "player_score",
    PLAYER_STAT: "player_stat",
    NETWORK_LATENCY: "network_latency"
});

export const OCR_JOB_STATES = Object.freeze({
    CREATED: "created",
    UPLOADING: "uploading",
    UPLOADED: "uploaded",
    QUEUED: "queued",
    DISPATCHING: "dispatching",
    PROCESSING: "processing",
    COMPLETED: "completed",
    FAILED: "failed"
});

export const OCR_DISPOSITIONS = Object.freeze({
    ACCEPTED: "accepted",
    NEEDS_REVIEW: "needs_review",
    REJECTED: "rejected"
});

export const OCR_CONFIRMATION_STATUSES = Object.freeze({
    AUTO_ACCEPTED: "auto_accepted",
    PENDING_REVIEW: "pending_review",
    CONFIRMED: "confirmed",
    CONFIRMED_WITH_DISPUTES: "confirmed_with_disputes"
});

export const OCR_SAFE_REJECTION_CODES = Object.freeze({
    IMAGE_INVALID: "image_invalid",
    SCOREBOARD_NOT_FOUND: "scoreboard_not_found",
    LAYOUT_UNSUPPORTED: "layout_unsupported",
    ROSTER_UNCERTAIN: "roster_uncertain",
    TOTALS_UNCERTAIN: "totals_uncertain",
    PROCESSING_UNAVAILABLE: "processing_unavailable"
});

export const OCR_RETENTION_POLICY = Object.freeze({
    materialArtifacts: "preserve",
    transientProgressHours: 24
});

const CONFIRMATION_DISPOSITION_MAP = Object.freeze({
    [OCR_CONFIRMATION_STATUSES.AUTO_ACCEPTED]: OCR_DISPOSITIONS.ACCEPTED,
    [OCR_CONFIRMATION_STATUSES.CONFIRMED]: OCR_DISPOSITIONS.ACCEPTED,
    [OCR_CONFIRMATION_STATUSES.CONFIRMED_WITH_DISPUTES]: OCR_DISPOSITIONS.ACCEPTED,
    [OCR_CONFIRMATION_STATUSES.PENDING_REVIEW]: OCR_DISPOSITIONS.NEEDS_REVIEW
});

const ALLOWED_JOB_TRANSITIONS = Object.freeze({
    [OCR_JOB_STATES.CREATED]: new Set([
        OCR_JOB_STATES.UPLOADING,
        OCR_JOB_STATES.FAILED
    ]),
    [OCR_JOB_STATES.UPLOADING]: new Set([
        OCR_JOB_STATES.UPLOADED,
        OCR_JOB_STATES.FAILED
    ]),
    [OCR_JOB_STATES.UPLOADED]: new Set([
        OCR_JOB_STATES.QUEUED,
        OCR_JOB_STATES.FAILED
    ]),
    [OCR_JOB_STATES.QUEUED]: new Set([
        OCR_JOB_STATES.DISPATCHING,
        OCR_JOB_STATES.PROCESSING,
        OCR_JOB_STATES.FAILED
    ]),
    [OCR_JOB_STATES.DISPATCHING]: new Set([
        OCR_JOB_STATES.PROCESSING,
        OCR_JOB_STATES.QUEUED,
        OCR_JOB_STATES.FAILED
    ]),
    [OCR_JOB_STATES.PROCESSING]: new Set([
        OCR_JOB_STATES.COMPLETED,
        OCR_JOB_STATES.QUEUED,
        OCR_JOB_STATES.FAILED
    ]),
    [OCR_JOB_STATES.COMPLETED]: new Set(),
    [OCR_JOB_STATES.FAILED]: new Set()
});

const REJECTION_PROFILES = Object.freeze({
    [OCR_SAFE_REJECTION_CODES.IMAGE_INVALID]: Object.freeze({
        messageKey: "ocr.rejection.image_invalid",
        retryable: false,
        reviewRequired: false,
        disposition: OCR_DISPOSITIONS.REJECTED
    }),
    [OCR_SAFE_REJECTION_CODES.SCOREBOARD_NOT_FOUND]: Object.freeze({
        messageKey: "ocr.rejection.scoreboard_not_found",
        retryable: false,
        reviewRequired: false,
        disposition: OCR_DISPOSITIONS.REJECTED
    }),
    [OCR_SAFE_REJECTION_CODES.LAYOUT_UNSUPPORTED]: Object.freeze({
        messageKey: "ocr.rejection.layout_unsupported",
        retryable: false,
        reviewRequired: true,
        disposition: OCR_DISPOSITIONS.NEEDS_REVIEW
    }),
    [OCR_SAFE_REJECTION_CODES.ROSTER_UNCERTAIN]: Object.freeze({
        messageKey: "ocr.rejection.roster_uncertain",
        retryable: false,
        reviewRequired: true,
        disposition: OCR_DISPOSITIONS.NEEDS_REVIEW
    }),
    [OCR_SAFE_REJECTION_CODES.TOTALS_UNCERTAIN]: Object.freeze({
        messageKey: "ocr.rejection.totals_uncertain",
        retryable: false,
        reviewRequired: true,
        disposition: OCR_DISPOSITIONS.NEEDS_REVIEW
    }),
    [OCR_SAFE_REJECTION_CODES.PROCESSING_UNAVAILABLE]: Object.freeze({
        messageKey: "ocr.rejection.processing_unavailable",
        retryable: true,
        reviewRequired: false,
        disposition: null
    })
});

function normalizeString(value) {
    return String(value ?? "").trim().toLowerCase();
}

function normalizeIdentifier(value) {
    return String(value ?? "").trim().toUpperCase();
}

export function normalizeOcrSourceMode(sourceMode) {
    const normalized = normalizeString(sourceMode);

    if (!normalized) {
        return null;
    }

    return Object.values(OCR_SOURCE_MODES).includes(normalized)
        ? normalized
        : null;
}

function normalizeRosterNames(value) {
    if (!Array.isArray(value)) {
        return null;
    }

    if (value.length === 0) {
        return null;
    }

    const names = value.map((name) => String(name ?? "").trim());

    if (names.some((name) => !name)) {
        return null;
    }

    const uniqueNames = new Set(names.map((name) => name.toLocaleUpperCase()));

    return uniqueNames.size === names.length ? names : null;
}

export function normalizeOcrRosterContract({
    sourceMode,
    playersPerTeam,
    team1Roster,
    team2Roster
} = {}) {
    const normalizedSourceMode = normalizeOcrSourceMode(sourceMode);

    if (normalizedSourceMode === OCR_SOURCE_MODES.AUTOMATIC) {
        const size = playersPerTeam == null || playersPerTeam === ""
            ? null
            : normalizeOcrRosterSize(playersPerTeam);
        const team1 = team1Roster == null ? null : normalizeRosterNames(team1Roster);
        const team2 = team2Roster == null ? null : normalizeRosterNames(team2Roster);
        const team1Unknown = team1Roster == null
            || (Array.isArray(team1Roster) && team1Roster.length === 0);
        const team2Unknown = team2Roster == null
            || (Array.isArray(team2Roster) && team2Roster.length === 0);

        if (
            (playersPerTeam != null && playersPerTeam !== "" && size === null)
            || (!team1Unknown && team1 === null)
            || (!team2Unknown && team2 === null)
            || ((team1 === null) !== (team2 === null))
            || (team1 && (size === null || team1.length !== size || team2.length !== size))
        ) {
            return null;
        }

        return {
            sourceMode: normalizedSourceMode,
            playersPerTeam: size,
            team1Roster: team1,
            team2Roster: team2
        };
    }

    if (normalizedSourceMode !== OCR_SOURCE_MODES.MANUAL) {
        return null;
    }

    const size = normalizeOcrRosterSize(playersPerTeam);
    const team1 = normalizeRosterNames(team1Roster);
    const team2 = normalizeRosterNames(team2Roster);

    if (
        size === null
        || !team1
        || !team2
        || team1.length !== size
        || team2.length !== size
        || new Set([...team1, ...team2].map((name) => name.toLocaleUpperCase())).size !== size * 2
    ) {
        return null;
    }

    return {
        sourceMode: normalizedSourceMode,
        playersPerTeam: size,
        team1Roster: team1,
        team2Roster: team2
    };
}

export function sanitizeOcrColumns(columns) {
    if (!Array.isArray(columns)) {
        return [];
    }

    const allowedSemantics = new Set(Object.values(OCR_COLUMN_SEMANTICS));
    const seenKeys = new Set();

    return columns.flatMap((column, index) => {
        const key = String(column?.key ?? "").trim();
        const semantic = normalizeString(column?.semantic);

        if (
            !/^[a-z][a-z0-9_]{0,47}$/i.test(key)
            || seenKeys.has(key)
            || !allowedSemantics.has(semantic)
        ) {
            return [];
        }

        seenKeys.add(key);

        return [{
            key,
            label: String(column?.label ?? key).trim().slice(0, 80) || key,
            semantic,
            editable: column?.editable === true,
            order: Number.isSafeInteger(column?.order) ? column.order : index
        }];
    }).sort((left, right) => left.order - right.order);
}

export function normalizeOcrImageSourceMode(submissionMode) {
    const normalized = normalizeString(submissionMode);

    if (!normalized) {
        return OCR_IMAGE_SOURCE_MODES.ORIGINAL_IMAGE;
    }

    return Object.values(OCR_IMAGE_SOURCE_MODES).includes(normalized)
        ? normalized
        : null;
}

export function normalizeOcrRosterSize(value) {
    let numericValue;

    if (typeof value === "number") {
        numericValue = value;
    }
    else if (
        typeof value === "string"
        && /^(?:[1-9]|1[0-6])$/.test(value.trim())
    ) {
        numericValue = Number(value.trim());
    }
    else {
        return null;
    }

    if (
        !Number.isInteger(numericValue)
        || numericValue < OCR_ROSTER_LIMITS.minimumPlayersPerTeam
        || numericValue > OCR_ROSTER_LIMITS.maximumPlayersPerTeam
    ) {
        return null;
    }

    return numericValue;
}

export function validateOcrRosterSizes({
    team1,
    team2,
    allowUnknown = false
} = {}) {
    const team1Size = normalizeOcrRosterSize(team1);
    const team2Size = normalizeOcrRosterSize(team2);

    if (allowUnknown && team1Size === null && team2Size === null) {
        return {
            valid: true,
            playersPerTeam: null
        };
    }

    if (team1Size === null || team2Size === null || team1Size !== team2Size) {
        return {
            valid: false,
            playersPerTeam: null
        };
    }

    return {
        valid: true,
        playersPerTeam: team1Size
    };
}

export function normalizeOcrDisposition(
    disposition,
    confirmationStatus = null,
    reviewRequired = false
) {
    const normalizedDisposition = normalizeString(disposition);
    const legacyDisposition = (
        CONFIRMATION_DISPOSITION_MAP[normalizeString(confirmationStatus)]
        || (reviewRequired === true ? OCR_DISPOSITIONS.NEEDS_REVIEW : null)
    );

    if (
        normalizedDisposition
        && !Object.values(OCR_DISPOSITIONS).includes(normalizedDisposition)
    ) {
        return null;
    }

    if (
        normalizedDisposition
        && legacyDisposition
        && normalizedDisposition !== legacyDisposition
    ) {
        return null;
    }

    return normalizedDisposition || legacyDisposition || null;
}

export function canTransitionOcrJobState(currentState, nextState) {
    const normalizedCurrent = normalizeString(currentState);
    const normalizedNext = normalizeString(nextState);

    if (normalizedCurrent === normalizedNext) {
        return false;
    }

    return Boolean(
        ALLOWED_JOB_TRANSITIONS[normalizedCurrent]?.has(normalizedNext)
    );
}

export function isIdempotentOcrStateEvent(currentState, eventState) {
    const normalizedCurrent = normalizeString(currentState);

    return Boolean(ALLOWED_JOB_TRANSITIONS[normalizedCurrent])
        && normalizedCurrent === normalizeString(eventState);
}

export function normalizeOcrAttempt(value) {
    const numericValue = Number(value);

    return Number.isSafeInteger(numericValue) && numericValue >= 1
        ? numericValue
        : null;
}

export function normalizeOcrExecutionId(value) {
    const executionId = normalizeIdentifier(value);

    return /^[A-Z0-9]{16,64}$/.test(executionId)
        ? executionId
        : null;
}

export function validateOcrExecutionFence({
    activeAttempt,
    activeExecutionId,
    receivedAttempt,
    receivedExecutionId
} = {}) {
    const normalizedActiveAttempt = normalizeOcrAttempt(activeAttempt);
    const normalizedReceivedAttempt = normalizeOcrAttempt(receivedAttempt);
    const normalizedActiveExecutionId = normalizeOcrExecutionId(activeExecutionId);
    const normalizedReceivedExecutionId = normalizeOcrExecutionId(receivedExecutionId);

    return Boolean(
        normalizedActiveAttempt
        && normalizedActiveAttempt === normalizedReceivedAttempt
        && normalizedActiveExecutionId
        && normalizedActiveExecutionId === normalizedReceivedExecutionId
    );
}

export function validateOcrTerminalOutcome({
    state,
    disposition = null,
    resultObjectKey = null,
    reviewObjectKey = null,
    reviewReason = null
} = {}) {
    const normalizedState = normalizeString(state);
    const normalizedDisposition = normalizeOcrDisposition(disposition);

    if (normalizedState === OCR_JOB_STATES.FAILED) {
        return {
            valid: normalizedDisposition === null,
            code: normalizedDisposition === null
                ? null
                : "FAILED_JOB_HAS_DISPOSITION"
        };
    }

    if (normalizedState !== OCR_JOB_STATES.COMPLETED) {
        return {
            valid: normalizedDisposition === null,
            code: normalizedDisposition === null
                ? null
                : "NONTERMINAL_JOB_HAS_DISPOSITION"
        };
    }

    if (normalizedDisposition === OCR_DISPOSITIONS.ACCEPTED) {
        const valid = Boolean(String(resultObjectKey || "").trim());

        return {
            valid,
            code: valid ? null : "ACCEPTED_RESULT_REFERENCE_MISSING"
        };
    }

    if (
        normalizedDisposition === OCR_DISPOSITIONS.NEEDS_REVIEW
        || normalizedDisposition === OCR_DISPOSITIONS.REJECTED
    ) {
        const valid = Boolean(String(reviewObjectKey || "").trim())
            && Boolean(String(reviewReason || "").trim());

        return {
            valid,
            code: valid ? null : "REVIEW_REFERENCE_MISSING"
        };
    }

    return {
        valid: false,
        code: "COMPLETED_DISPOSITION_MISSING"
    };
}

export function sanitizeOcrRejectionDetail(detail) {
    const requestedCode = normalizeString(detail?.code);
    const allowedCode = Object.hasOwn(REJECTION_PROFILES, requestedCode)
        ? requestedCode
        : OCR_SAFE_REJECTION_CODES.PROCESSING_UNAVAILABLE;

    return {
        code: allowedCode,
        ...REJECTION_PROFILES[allowedCode]
    };
}
