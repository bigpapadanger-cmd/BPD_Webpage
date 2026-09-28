"use strict";

const GOOGLE_TOKEN_SCOPE =
    "https://www.googleapis.com/auth/cloud-platform";

const IAM_CREDENTIALS_URL =
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts";

const GOOGLE_STS_URL =
    "https://sts.mtls.googleapis.com/v1/token";

const FEDERATED_TOKEN_TYPE =
    "urn:ietf:params:oauth:token-type:access_token";

const X509_SUBJECT_TOKEN_TYPE =
    "urn:ietf:params:oauth:token-type:mtls";

const TOKEN_EXCHANGE_GRANT =
    "urn:ietf:params:oauth:grant-type:token-exchange";

const GOOGLE_REQUEST_TIMEOUT_MS =
    10000;

const TOKEN_REFRESH_SKEW_MS =
    120000;

const MAX_CERTIFICATE_CHAIN_LENGTH =
    8;

const MAX_CERTIFICATE_BYTES =
    16384;

const MAX_GOOGLE_RESPONSE_BYTES =
    65536;

const FEDERATED_TOKEN_CACHE =
    new Map();

const ID_TOKEN_CACHE =
    new Map();

function createAuthError(
    code,
    message
) {
    const error =
        new Error(message);

    error.code =
        code;

    error.httpStatus =
        503;

    return error;
}

function readConfiguration(
    env
) {
    const projectNumber =
        String(
            env?.OCR_GCP_PROJECT_NUMBER
            || ""
        ).trim();

    const poolId =
        String(
            env?.OCR_GCP_WORKLOAD_IDENTITY_POOL_ID
            || ""
        ).trim();

    const providerId =
        String(
            env?.OCR_GCP_WORKLOAD_IDENTITY_PROVIDER_ID
            || ""
        ).trim();

    const serviceAccountEmail =
        String(
            env?.OCR_GCP_SERVICE_ACCOUNT_EMAIL
            || ""
        ).trim();

    if (
        !/^\d{6,20}$/.test(projectNumber)
        || !/^[a-z][a-z0-9-]{2,31}$/.test(poolId)
        || !/^[a-z][a-z0-9-]{2,31}$/.test(providerId)
        || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/i.test(
            serviceAccountEmail
        )
    ) {
        throw createAuthError(
            "OCR_GOOGLE_WIF_CONFIG_INVALID",
            "Google Workload Identity Federation is not configured correctly."
        );
    }

    const certificateBinding =
        env?.OCR_GCP_MTLS;

    if (
        !certificateBinding
        || typeof certificateBinding.fetch !== "function"
    ) {
        throw createAuthError(
            "OCR_GOOGLE_MTLS_BINDING_MISSING",
            "Google Workload Identity Federation is not configured correctly."
        );
    }

    const certificateChain =
        readCertificateChain(env);

    return {
        projectNumber,
        poolId,
        providerId,
        serviceAccountEmail,
        certificateChain,
        certificateBinding,
        providerResource:
            "//iam.googleapis.com/projects/"
            + projectNumber
            + "/locations/global/workloadIdentityPools/"
            + poolId
            + "/providers/"
            + providerId
    };
}

function readCertificateChain(
    env
) {
    const serialized =
        String(
            env?.OCR_GCP_X509_CERT_CHAIN
            || ""
        ).trim();

    if (
        !serialized
        || serialized.length >
            MAX_CERTIFICATE_CHAIN_LENGTH
            * MAX_CERTIFICATE_BYTES
            * 1.5
    ) {
        throw createAuthError(
            "OCR_GOOGLE_CERTIFICATE_CHAIN_MISSING",
            "Google Workload Identity Federation is not configured correctly."
        );
    }

    let chain;

    try {
        chain = JSON.parse(serialized);
    }
    catch {
        throw createAuthError(
            "OCR_GOOGLE_CERTIFICATE_CHAIN_INVALID",
            "Google Workload Identity Federation is not configured correctly."
        );
    }

    if (
        !Array.isArray(chain)
        || chain.length < 1
        || chain.length > MAX_CERTIFICATE_CHAIN_LENGTH
    ) {
        throw createAuthError(
            "OCR_GOOGLE_CERTIFICATE_CHAIN_INVALID",
            "Google Workload Identity Federation is not configured correctly."
        );
    }

    return chain.map(function(certificate) {
        if (
            typeof certificate !== "string"
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(certificate)
            || certificate.length % 4 === 1
        ) {
            throw createAuthError(
                "OCR_GOOGLE_CERTIFICATE_CHAIN_INVALID",
                "Google Workload Identity Federation is not configured correctly."
            );
        }

        let decoded;

        try {
            decoded = atob(
                certificate.padEnd(
                    certificate.length
                    + (4 - certificate.length % 4) % 4,
                    "="
                )
            );
        }
        catch {
            throw createAuthError(
                "OCR_GOOGLE_CERTIFICATE_CHAIN_INVALID",
                "Google Workload Identity Federation is not configured correctly."
            );
        }

        if (
            decoded.length < 128
            || decoded.length > MAX_CERTIFICATE_BYTES
        ) {
            throw createAuthError(
                "OCR_GOOGLE_CERTIFICATE_CHAIN_INVALID",
                "Google Workload Identity Federation is not configured correctly."
            );
        }

        return certificate;
    });
}

async function hashCertificateChain(
    chain
) {
    const digest =
        await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(
                JSON.stringify(chain)
            )
        );

    return Array.from(
        new Uint8Array(digest),
        function(byte) {
            return byte.toString(16).padStart(2, "0");
        }
    ).join("");
}

async function fetchJson(
    fetcher,
    url,
    options,
    failureCode
) {
    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            function() {
                controller.abort();
            },
            GOOGLE_REQUEST_TIMEOUT_MS
        );

    try {
        const response =
            await fetcher(
                url,
                {
                    ...options,
                    signal:
                        controller.signal
                }
            );

        const contentLength =
            Number(
                response.headers.get(
                    "Content-Length"
                )
            );

        if (
            Number.isFinite(contentLength)
            && contentLength > MAX_GOOGLE_RESPONSE_BYTES
        ) {
            throw createAuthError(
                failureCode,
                "Google authentication returned an invalid response."
            );
        }

        const text =
            await response.text();

        if (
            text.length > MAX_GOOGLE_RESPONSE_BYTES
            || !response.ok
        ) {
            throw createAuthError(
                failureCode,
                "Google authentication could not be completed."
            );
        }

        try {
            return JSON.parse(text);
        }
        catch {
            throw createAuthError(
                failureCode,
                "Google authentication returned an invalid response."
            );
        }
    }
    catch (error) {
        if (error?.code) {
            throw error;
        }

        throw createAuthError(
            failureCode,
            "Google authentication could not be completed."
        );
    }
    finally {
        clearTimeout(timeout);
    }
}

async function getCachedToken(
    cache,
    cacheKey,
    createToken
) {
    const now =
        Date.now();

    const cached =
        cache.get(cacheKey);

    if (
        cached?.token
        && cached.expiresAt > now + TOKEN_REFRESH_SKEW_MS
    ) {
        return cached.token;
    }

    if (cached?.pending) {
        return cached.pending;
    }

    const entry = {
        token: "",
        expiresAt: 0,
        pending: null
    };

    entry.pending =
        Promise.resolve()
            .then(createToken)
            .then(function(result) {
                entry.token = result.token;
                entry.expiresAt = result.expiresAt;
                entry.pending = null;
                return entry.token;
            })
            .catch(function(error) {
                if (cache.get(cacheKey) === entry) {
                    cache.delete(cacheKey);
                }

                throw error;
            });

    cache.set(cacheKey, entry);
    return entry.pending;
}

function readTokenLifetime(
    expiresIn
) {
    const seconds =
        Number(expiresIn);

    if (
        !Number.isFinite(seconds)
        || seconds <= 120
    ) {
        throw createAuthError(
            "OCR_GOOGLE_STS_RESPONSE_INVALID",
            "Google authentication returned an invalid response."
        );
    }

    return Date.now() + seconds * 1000;
}

function readJwtExpiry(
    token
) {
    try {
        const segments =
            String(token).split(".");

        if (segments.length !== 3) {
            return 0;
        }

        const payload =
            segments[1]
                .replace(/-/g, "+")
                .replace(/_/g, "/");

        const decoded =
            JSON.parse(
                atob(
                    payload.padEnd(
                        payload.length
                        + (4 - payload.length % 4) % 4,
                        "="
                    )
                )
            );

        return Number(decoded.exp) || 0;
    }
    catch {
        return 0;
    }
}

async function getFederatedAccessToken(
    config,
    certificateFingerprint
) {
    const cacheKey =
        config.providerResource
        + ":"
        + certificateFingerprint;

    return getCachedToken(
        FEDERATED_TOKEN_CACHE,
        cacheKey,
        async function() {
            const response =
                await fetchJson(
                    function(url, options) {
                        return config.certificateBinding.fetch(
                            url,
                            options
                        );
                    },
                    GOOGLE_STS_URL,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            grant_type:
                                TOKEN_EXCHANGE_GRANT,
                            audience:
                                config.providerResource,
                            requested_token_type:
                                FEDERATED_TOKEN_TYPE,
                            subject_token_type:
                                X509_SUBJECT_TOKEN_TYPE,
                            subject_token:
                                JSON.stringify(
                                    config.certificateChain
                                ),
                            scope:
                                GOOGLE_TOKEN_SCOPE
                        })
                    },
                    "OCR_GOOGLE_STS_EXCHANGE_FAILED"
                );

            if (
                typeof response.access_token !== "string"
                || !response.access_token
            ) {
                throw createAuthError(
                    "OCR_GOOGLE_STS_RESPONSE_INVALID",
                    "Google authentication returned an invalid response."
                );
            }

            return {
                token:
                    response.access_token,
                expiresAt:
                    readTokenLifetime(
                        response.expires_in
                    )
            };
        }
    );
}

function buildCloudRunAudience(
    serviceUrl
) {
    try {
        const url =
            new URL(serviceUrl);

        if (
            url.protocol !== "https:"
            || url.username
            || url.password
        ) {
            throw new Error("Invalid URL.");
        }

        return url.origin;
    }
    catch {
        throw createAuthError(
            "OCR_GOOGLE_AUDIENCE_INVALID",
            "Google Cloud Run URL is invalid."
        );
    }
}

export async function getGoogleCloudRunIdToken(
    env,
    serviceUrl
) {
    const config =
        readConfiguration(env);

    const audience =
        buildCloudRunAudience(serviceUrl);

    const certificateFingerprint =
        await hashCertificateChain(
            config.certificateChain
        );

    const identityKey =
        config.providerResource
        + ":"
        + certificateFingerprint
        + ":"
        + config.serviceAccountEmail;

    return getCachedToken(
        ID_TOKEN_CACHE,
        identityKey + ":" + audience,
        async function() {
            const federatedAccessToken =
                await getFederatedAccessToken(
                    config,
                    certificateFingerprint
                );

            const endpoint =
                IAM_CREDENTIALS_URL
                + "/"
                + encodeURIComponent(
                    config.serviceAccountEmail
                )
                + ":generateIdToken";

            const response =
                await fetchJson(
                    fetch,
                    endpoint,
                    {
                        method: "POST",
                        headers: {
                            Authorization:
                                "Bearer "
                                + federatedAccessToken,
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            audience,
                            includeEmail: true
                        })
                    },
                    "OCR_GOOGLE_ID_TOKEN_FAILED"
                );

            if (
                typeof response.token !== "string"
                || !response.token
            ) {
                throw createAuthError(
                    "OCR_GOOGLE_ID_TOKEN_RESPONSE_INVALID",
                    "Google authentication returned an invalid response."
                );
            }

            const expiry =
                readJwtExpiry(response.token);

            if (expiry * 1000 <= Date.now()) {
                throw createAuthError(
                    "OCR_GOOGLE_ID_TOKEN_RESPONSE_INVALID",
                    "Google authentication returned an invalid response."
                );
            }

            return {
                token:
                    response.token,
                expiresAt:
                    expiry * 1000
            };
        }
    );
}
