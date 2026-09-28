import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    onRequestPost,
    runMtlsProbe
} from "../../functions/api/ocr/debug/mtls-probe.js";
import {
    ADMIN_PERMISSIONS,
    getPermissionsForDiscordRoles
} from "../../functions/services/admin/permissions.js";

const GOOGLE_STS_URL = "https://sts.mtls.googleapis.com/v1/token";
const GOOGLE_STS_HOSTNAME = "sts.mtls.googleapis.com";

function captureConsoleInfo(run) {
    const originalInfo = console.info;
    const calls = [];
    console.info = (...args) => calls.push(args);

    return Promise.resolve()
        .then(run)
        .finally(() => {
            console.info = originalInfo;
        })
        .then(result => ({ result, calls }));
}

test("mTLS probe rejects unauthenticated callers before contacting Google", async () => {
    let fetchCalls = 0;
    const response = await onRequestPost({
        request: new Request("https://example.test/api/ocr/debug/mtls-probe", {
            method: "POST"
        }),
        env: {
            AUTH_SESSIONS: {
                async get() {
                    return null;
                }
            },
            OCR_GCP_MTLS: {
                async fetch() {
                    fetchCalls += 1;
                    return Response.json({});
                }
            }
        }
    });

    assert.equal(response.status, 401);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(await response.json(), {
        probeCompleted: false,
        error: "AUTHENTICATION_REQUIRED"
    });
});

test("mTLS probe requires the existing admin-only settings permission", async () => {
    const source = await readFile(
        new URL("../../functions/api/ocr/debug/mtls-probe.js", import.meta.url),
        "utf8"
    );

    assert.match(source, /authorizeAdminPermission/);
    assert.match(source, /ADMIN_PERMISSIONS\.ADMIN_SETTINGS_MANAGE/);
    assert.equal(
        getPermissionsForDiscordRoles({ isModerator: true })
            .includes(ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE),
        false
    );
    assert.equal(
        getPermissionsForDiscordRoles({ isLeagueStaff: true })
            .includes(ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE),
        false
    );
    assert.equal(
        getPermissionsForDiscordRoles({ isAdmin: true })
            .includes(ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE),
        true
    );
});

test("isolated probe uses the mTLS binding directly without token helpers", async () => {
    const requests = [];
    const { result: response, calls } = await captureConsoleInfo(() =>
        runMtlsProbe({
            OCR_GCP_MTLS: {
                async fetch(url, options) {
                    requests.push({ url: String(url), options });
                    return Response.json({
                        error: "invalid_request",
                        error_description: "Missing required parameter: grant_type"
                    }, { status: 400 });
                }
            }
        })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        probeCompleted: true,
        bindingExists: true,
        bindingFetchIsFunction: true,
        destinationHostname: GOOGLE_STS_HOSTNAME,
        httpStatus: 400,
        googleError: "invalid_request",
        googleErrorDescription: "Missing required parameter: grant_type"
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, GOOGLE_STS_URL);
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[0].options.body, "");
    assert.equal(requests[0].options.redirect, "manual");
    assert.equal(requests[0].options.headers.Authorization, undefined);
    assert.equal(Object.keys(calls[0][1]).length, 6);

    const source = await readFile(
        new URL("../../functions/api/ocr/debug/mtls-probe.js", import.meta.url),
        "utf8"
    );
    assert.match(source, /env\.OCR_GCP_MTLS\.fetch/);
    assert.doesNotMatch(source, /googleCloudAuth|getGoogleCloudRunIdToken/);
});

test("mTLS probe never logs or returns credential-like values from Google errors", async () => {
    const unsafeDescription = [
        "subject_token=subject-token-secret",
        "access_token: access-token-secret",
        "id_token=id-token-secret",
        "OCR_API_KEY=api-key-secret",
        "Bearer bearer-secret",
        "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.signature",
        "-----BEGIN PRIVATE KEY-----private-key-secret-----END PRIVATE KEY-----"
    ].join(" ");

    const { result: response, calls } = await captureConsoleInfo(() =>
        runMtlsProbe({
            OCR_GCP_MTLS: {
                async fetch() {
                    return Response.json({
                        error: "invalid_request",
                        error_description: unsafeDescription,
                        access_token: "response-token-secret"
                    }, { status: 400 });
                }
            }
        })
    );

    const logged = JSON.stringify(calls);
    const returned = JSON.stringify(await response.json());
    for (const secret of [
        "subject-token-secret",
        "access-token-secret",
        "id-token-secret",
        "api-key-secret",
        "bearer-secret",
        "signature",
        "private-key-secret",
        "response-token-secret"
    ]) {
        assert.equal(logged.includes(secret), false, `log leaked ${secret}`);
        assert.equal(returned.includes(secret), false, `response leaked ${secret}`);
    }

    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0][1]).sort(), [
        "bindingExists",
        "bindingFetchIsFunction",
        "destinationHostname",
        "googleError",
        "googleErrorDescription",
        "httpStatus"
    ].sort());
    assert.equal(calls[0][1].bindingExists, true);
    assert.equal(calls[0][1].bindingFetchIsFunction, true);
    assert.equal(calls[0][1].destinationHostname, GOOGLE_STS_HOSTNAME);
    assert.equal(calls[0][1].httpStatus, 400);
});
