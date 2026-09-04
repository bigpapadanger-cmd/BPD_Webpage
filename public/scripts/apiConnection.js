"use strict";


/* =========================================================
BPD GAMING NETWORK
GLOBAL API CONNECTION GATE

Behavior:
    1. Gate starts locked.
    2. Initial page load checks:
        - basic browser internet state
        - BPD API health
    3. Successful API health check unlocks the gate.
    4. While internet remains available, the gate stays
       unlocked.
    5. Every API action still performs the cheap browser
       internet check.
    6. Losing internet immediately locks the gate.
    7. Regaining internet does NOT automatically unlock it.
    8. The next API action performs the API health check
       before continuing.
    9. API network failures and 502/503/504 responses lock
       the gate again.
=========================================================
*/

import {
    API_HEALTH_URL
} from "./apiRoutes.js";


const API_CHECK_TIMEOUT_MS =
    5000;

const INTERNET_CHECK_INTERVAL_MS =
    30000;

let apiConnectionUnlocked =
    false;

let apiCheckPromise =
    null;

let internetMonitorId =
    null;


/* =========================================================
BASIC INTERNET STATUS
=========================================================
*/

export function hasBasicInternetConnection() {
    return (
        navigator.onLine !== false
    );
}


/* =========================================================
GATE STATUS
=========================================================
*/

export function isApiConnectionUnlocked() {
    return (
        apiConnectionUnlocked === true
    );
}


/* =========================================================
LOCK API GATE
=========================================================
*/

function lockApiConnection() {
    apiConnectionUnlocked =
        false;

    document.body.dataset.apiConnection =
        "locked";
}


/* =========================================================
UNLOCK API GATE
=========================================================
*/

function unlockApiConnection() {
    apiConnectionUnlocked =
        true;

    document.body.dataset.apiConnection =
        "ready";
}


/* =========================================================
UPDATE BASIC NETWORK STATE
=========================================================
*/

function updateBasicInternetState() {
    const online =
        hasBasicInternetConnection();

    document.body.dataset.network =
        online
            ? "online"
            : "offline";

    if (
        !online
    ) {
        lockApiConnection();
    }

    return online;
}


/* =========================================================
MICRO API HEALTH CHECK
=========================================================
*/

async function checkApiConnection() {
    if (
        !updateBasicInternetState()
    ) {
        throw new Error(
            "NETWORK_OFFLINE"
        );
    }

    /*
     * Reuse an already-running API health request if
     * multiple API actions arrive at the same time.
     */
    if (
        apiCheckPromise
    ) {
        return apiCheckPromise;
    }

    apiCheckPromise =
        performApiConnectionCheck();

    try {
        await apiCheckPromise;

        unlockApiConnection();

        return true;
    }
    finally {
        apiCheckPromise =
            null;
    }
}


/* =========================================================
PERFORM MICRO GET

IMPORTANT:
    This must use native fetch(), not apiFetch(), otherwise
    the API gate would call itself recursively.
=========================================================
*/

async function performApiConnectionCheck() {
    const controller =
        new AbortController();

    const timeoutId =
        window.setTimeout(
            function() {
                controller.abort();
            },
            API_CHECK_TIMEOUT_MS
        );

    try {
        const response =
            await fetch(
                API_HEALTH_URL,
                {
                    method:
                        "GET",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    signal:
                        controller.signal,

                    headers: {
                        "accept":
                            "application/json"
                    }
                }
            );

        if (
            !response.ok
        ) {
            throw new Error(
                `API_HEALTH_HTTP_${response.status}`
            );
        }

        const result =
            await response.json()
                .catch(
                    function() {
                        return null;
                    }
                );

        if (
            result?.success !==
            true
        ) {
            throw new Error(
                "API_HEALTH_CHECK_FAILED"
            );
        }

        return true;
    }
    catch (
        error
    ) {
        lockApiConnection();

        document.dispatchEvent(
            new CustomEvent(
                "bpd:network-status",
                {
                    detail: {
                        online:
                            hasBasicInternetConnection(),

                        apiReady:
                            false
                    }
                }
            )
        );

        if (
            error?.name ===
            "AbortError"
        ) {
            throw new Error(
                "API_CONNECTION_TIMEOUT"
            );
        }

        throw error;
    }
    finally {
        window.clearTimeout(
            timeoutId
        );
    }
}


/* =========================================================
GLOBAL API GATE

Every API action:
    1. Checks basic internet state.
    2. If the gate is already unlocked, continue.
    3. If the gate is locked, verify /api/health first.
=========================================================
*/

export async function requireApiConnection() {
    /*
     * This cheap browser check ALWAYS runs.
     */
    if (
        !updateBasicInternetState()
    ) {
        throw new Error(
            "NETWORK_OFFLINE"
        );
    }

    /*
     * Internet has remained available and the BPD API was
     * previously confirmed.
     *
     * Keep the gate unlocked and continue immediately.
     */
    if (
        apiConnectionUnlocked
    ) {
        return true;
    }

    /*
     * Something caused us to distrust the API connection.
     *
     * Reconfirm it before allowing the action through.
     */
    return checkApiConnection();
}


/* =========================================================
GLOBAL API FETCH

Use this for client requests to BPD /api/* endpoints.

The API health endpoint itself must NOT use apiFetch().
=========================================================
*/

export async function apiFetch(
    url,
    options = {}
) {
    await requireApiConnection();

    /*
     * Check basic connectivity again immediately before the
     * actual request.
     *
     * This is extremely cheap and closes the small window
     * between the gate check and the real API call.
     */
    if (
        !updateBasicInternetState()
    ) {
        throw new Error(
            "NETWORK_OFFLINE"
        );
    }

    try {
        const response =
            await fetch(
                url,
                options
            );

        /*
         * These statuses generally indicate that the
         * server/gateway connection should no longer be
         * considered trusted.
         *
         * Do not lock for normal application-level 4xx
         * responses.
         */
        if (
            response.status === 502
            || response.status === 503
            || response.status === 504
        ) {
            lockApiConnection();
        }

        return response;
    }
    catch (
        error
    ) {
        /*
         * A fetch-level failure means we can no longer
         * trust the existing API connection state.
         */
        lockApiConnection();

        throw error;
    }
}


/* =========================================================
NETWORK STATUS EVENTS

OFFLINE:
    immediately lock the API gate.

ONLINE:
    mark basic internet as restored but KEEP the API gate
    locked.

The next API action must prove /api/health works again.
=========================================================
*/

window.addEventListener(
    "offline",
    function() {
        lockApiConnection();

        document.body.dataset.network =
            "offline";

        document.dispatchEvent(
            new CustomEvent(
                "bpd:network-status",
                {
                    detail: {
                        online:
                            false,

                        apiReady:
                            false
                    }
                }
            )
        );
    }
);


window.addEventListener(
    "online",
    function() {
        /*
         * The browser reports that a network connection
         * exists again.
         *
         * This does NOT prove that BPD's API is reachable,
         * so leave the API gate locked.
         */
        lockApiConnection();

        document.body.dataset.network =
            "online";

        document.dispatchEvent(
            new CustomEvent(
                "bpd:network-status",
                {
                    detail: {
                        online:
                            true,

                        apiReady:
                            false
                    }
                }
            )
        );
    }
);


/* =========================================================
30-SECOND BASIC INTERNET MONITOR

This does NOT call /api/health every 30 seconds.

Its only job is to notice basic browser connectivity loss.

As long as internet remains available:
    - the API gate remains unlocked
    - no extra health request is made
=========================================================
*/

function runBasicInternetMonitorCheck() {
    const online =
        updateBasicInternetState();

    document.dispatchEvent(
        new CustomEvent(
            "bpd:network-monitor",
            {
                detail: {
                    online,

                    apiReady:
                        (
                            online
                            && apiConnectionUnlocked
                        )
                }
            }
        )
    );
}


/* =========================================================
INITIALIZE API CONNECTION MONITOR

Call ONCE from the application's global index.js.

Initial load:
    internet check
    ↓
    /api/health
    ↓
    unlock on success

After that:
    30-second checks only inspect browser internet state.
=========================================================
*/

export async function initializeApiConnectionMonitor() {
    if (
        internetMonitorId !==
        null
    ) {
        return;
    }

    /*
     * Establish initial browser network state.
     */
    const online =
        updateBasicInternetState();

    /*
     * Verify BPD API availability once on application load.
     */
    if (
        online
    ) {
        try {
            await checkApiConnection();
        }
        catch (
            error
        ) {
            console.warn(
                "API CONNECTION: Initial API health check failed.",
                error
            );
        }
    }

    /*
     * Monitor only basic browser connectivity from here.
     */
    internetMonitorId =
        window.setInterval(
            runBasicInternetMonitorCheck,
            INTERNET_CHECK_INTERVAL_MS
        );
}

function initializeNetworkStatusToast() {
    let toast =
        document.getElementById(
            "networkStatusToast"
        );

    if (
        !toast
    ) {
        toast =
            document.createElement(
                "div"
            );

        toast.id =
            "networkStatusToast";

        toast.className =
            "network-status-toast";

        toast.setAttribute(
            "role",
            "status"
        );

        toast.setAttribute(
            "aria-live",
            "polite"
        );

        document.body.appendChild(
            toast
        );
    }

    document.addEventListener(
        "bpd:network-status",
        function(
            event
        ) {
            const online =
                event.detail
                    ?.online === true;

            const apiReady =
                event.detail
                    ?.apiReady === true;

            if (
                !online
            ) {
                showNetworkStatusToast(
                    "No internet connection.",
                    "error"
                );

                return;
            }

            if (
                !apiReady
            ) {
                showNetworkStatusToast(
                    "Unable to connect to BPD services.",
                    "error"
                );
            }
        }
    );
}


function showNetworkStatusToast(
    message,
    type = "error"
) {
    const toast =
        document.getElementById(
            "networkStatusToast"
        );

    if (
        !toast
    ) {
        return;
    }

    toast.textContent =
        message;

    toast.dataset.type =
        type;

    toast.classList.add(
        "visible"
    );

    window.clearTimeout(
        toast.hideTimer
    );

    toast.hideTimer =
        window.setTimeout(
            function() {
                toast.classList.remove(
                    "visible"
                );
            },
            4000
        );
}
/* =========================================================
INITIAL STATE

The API must prove itself before being trusted.
=========================================================
*/

lockApiConnection();

updateBasicInternetState();
initializeNetworkStatusToast();