"use strict";

/* =========================================================
BPD GAMING NETWORK
HTTP RESPONSE HELPERS

File:
    functions/services/http/responses.js

Purpose:
    Provides shared HTTP response helpers for server routes.

Description:
    - Creates consistent JSON responses.
    - Creates standardized method-not-allowed responses.
    - Applies no-store headers to API responses.
    - Prevents duplicated response construction across routes.
========================================================= */

/* =========================================================
JSON RESPONSE
========================================================= */

export function jsonResponse(
    body,
    status = 200,
    additionalHeaders = {}
) {
    const headers =
        new Headers({
            "Content-Type":
                "application/json; charset=utf-8",

            "Cache-Control":
                "no-store"
        });

    for (
        const [
            name,
            value
        ]
        of Object.entries(
            additionalHeaders
        )
    ) {
        headers.set(
            name,
            value
        );
    }

    return new Response(
        JSON.stringify(
            body
        ),
        {
            status,
            headers
        }
    );
}

/* =========================================================
METHOD NOT ALLOWED
========================================================= */

export function methodNotAllowedResponse(
    allowedMethods = []
) {
    const methods =
        Array.isArray(
            allowedMethods
        )
            ? allowedMethods
            : [
                allowedMethods
            ];

    const normalizedMethods =
        methods
            .map(
                method =>
                    String(
                        method
                        || ""
                    )
                        .trim()
                        .toUpperCase()
            )
            .filter(
                Boolean
            );

    const headers =
        {};

    if (
        normalizedMethods.length >
        0
    ) {
        headers.Allow =
            normalizedMethods.join(
                ", "
            );
    }

    return jsonResponse(
        {
            success:
                false,

            error:
                "METHOD_NOT_ALLOWED"
        },
        405,
        headers
    );
}
// HTTP projection only: retain canonical identifiers inside the server pipeline.
// Opt in only where consumers use explicit access flags, not database keys.
const INTERNAL_IDENTIFIER_KEYS = new Set(["accountid", "userid", "rlplayerid", "playerid", "snapshotid", "epicuniqueid", "epicaccountid", "providersubject", "provideraccountid"]);
export function omitInternalIdentifiers(value) {
    if (Array.isArray(value)) return value.map(omitInternalIdentifiers);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !INTERNAL_IDENTIFIER_KEYS.has(key.replaceAll("_", "").toLowerCase()))
        .map(([key, item]) => [key, omitInternalIdentifiers(item)]));
}
