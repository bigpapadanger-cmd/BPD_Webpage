import {
    json,
    redirect
} from "../common_helpers/responses.js";

import {
    EPIC_TOKEN_URL,
    EPIC_USER_INFO_URL,
    AUTH_STATE_COOKIE,
    AUTH_SESSION_COOKIE
} from "../../api_vars.js";

import {
    getCookie,
    createCookie,
    SESSION_TTL
} from "../common_helpers/reload_sessions.js";


/*
=========================================================
LOGGING HELPERS
=========================================================
*/

/*
Masks the Epic client ID before it is written to logs.

Example:
abcdef1234567890
becomes:
abcdef...7890
*/
function maskClientId(clientId) {

    if (
        !clientId ||
        clientId.length < 10
    ) {
        return "missing-or-invalid";
    }

    return (
        `${clientId.slice(0, 6)}` +
        `...` +
        `${clientId.slice(-4)}`
    );
}


/*
Limits upstream error messages before logging them.

This prevents an unexpectedly large Epic response from
filling Cloudflare logs.
*/
function limitMessage(value) {

    return String(
        value || ""
    )
        .replace(
            /\s+/g,
            " "
        )
        .slice(
            0,
            500
        );
}


/*
=========================================================
EPIC CALLBACK
=========================================================
*/

export async function handleEpicCallback(
    request,
    env
) {

    /*
    Create a unique ID for this callback attempt.

    This makes it easier to connect all Cloudflare log
    entries associated with one authentication request.
    */
    const debugId =
        crypto.randomUUID();


    /*
    Parse Epic's callback URL.

    Expected example:

    /api/auth/epic/callback
        ?code=...
        &state=...
    */
    const url =
        new URL(
            request.url
        );


    const code =
        url.searchParams.get(
            "code"
        );


    const state =
        url.searchParams.get(
            "state"
        );


    console.info(
        "EPIC CALLBACK SERVICE: Started.",
        {
            debugId,

            method:
                request.method,

            pathname:
                url.pathname,

            hasCode:
                Boolean(code),

            hasState:
                Boolean(state),

            hasOAuthError:
                url.searchParams.has(
                    "error"
                )
        }
    );


    try {

        /*
        =====================================================
        1. VERIFY EPIC CALLBACK PARAMETERS
        =====================================================
        */

        /*
        Epic should return both:
        - authorization code
        - OAuth state

        If either is missing, authentication cannot continue.
        */
        if (
            !code ||
            !state
        ) {

            console.error(
                "EPIC CALLBACK SERVICE: OAuth parameters missing.",
                {
                    debugId,

                    hasCode:
                        Boolean(code),

                    hasState:
                        Boolean(state),

                    oauthError:
                        url.searchParams.get(
                            "error"
                        ),

                    oauthErrorDescription:
                        limitMessage(
                            url.searchParams.get(
                                "error_description"
                            )
                        )
                }
            );


            return json(
                {
                    success: false,

                    message:
                        "Missing OAuth parameters.",

                    debugId
                },
                400
            );
        }


        /*
        =====================================================
        2. VERIFY OAUTH STATE
        =====================================================
        */

        /*
        The login handler generated a random state and stored
        it in AUTH_STATE_COOKIE before sending the browser
        to Epic.

        Epic returns that same state here.

        These must match.
        */
        const storedState =
            getCookie(
                request,
                AUTH_STATE_COOKIE
            );


        const stateMatches =
            Boolean(
                storedState &&
                storedState === state
            );


        console.info(
            "EPIC CALLBACK SERVICE: State checked.",
            {
                debugId,

                hasStoredState:
                    Boolean(
                        storedState
                    ),

                stateMatches
            }
        );


        if (
            !storedState ||
            !stateMatches
        ) {

            console.error(
                "EPIC CALLBACK SERVICE: OAuth state invalid.",
                {
                    debugId,

                    hasStoredState:
                        Boolean(
                            storedState
                        )
                }
            );


            return json(
                {
                    success: false,

                    message:
                        "Invalid OAuth state.",

                    debugId
                },
                400
            );
        }


        /*
        =====================================================
        3. LOAD EPIC CONFIGURATION
        =====================================================
        */

        const clientId =
            typeof env.EPIC_CLIENT_ID ===
            "string"
                ? env.EPIC_CLIENT_ID.trim()
                : "";


        const clientSecret =
            typeof env.EPIC_CLIENT_SECRET ===
            "string"
                ? env.EPIC_CLIENT_SECRET.trim()
                : "";


        const redirectUri =
            typeof env.EPIC_REDIRECT_URI ===
            "string"
                ? env.EPIC_REDIRECT_URI.trim()
                : "";


        console.info(
            "EPIC CALLBACK SERVICE: Configuration loaded.",
            {
                debugId,

                clientId:
                    maskClientId(
                        clientId
                    ),

                hasClientSecret:
                    Boolean(
                        clientSecret
                    ),

                redirectUri,

                tokenUrl:
                    EPIC_TOKEN_URL,

                userInfoUrl:
                    EPIC_USER_INFO_URL,

                hasSessionBinding:
                    Boolean(
                        env.AUTH_SESSIONS
                    )
            }
        );


        /*
        Do not attempt authentication without the required
        server-side Epic OAuth configuration.
        */
        if (
            !clientId ||
            !clientSecret ||
            !redirectUri
        ) {

            console.error(
                "EPIC CALLBACK SERVICE: Configuration invalid.",
                {
                    debugId,

                    hasClientId:
                        Boolean(
                            clientId
                        ),

                    hasClientSecret:
                        Boolean(
                            clientSecret
                        ),

                    hasRedirectUri:
                        Boolean(
                            redirectUri
                        )
                }
            );


            return json(
                {
                    success: false,

                    message:
                        "Epic callback configuration invalid.",

                    debugId
                },
                500
            );
        }


        /*
        =====================================================
        4. EXCHANGE AUTHORIZATION CODE FOR ACCESS TOKEN
        =====================================================
        */

        console.info(
            "EPIC CALLBACK SERVICE: Starting token exchange.",
            {
                debugId,

                clientId:
                    maskClientId(
                        clientId
                    ),

                redirectUri
            }
        );


        /*
        The authorization code returned by Epic is exchanged
        server-side using the application credentials.

        Never expose EPIC_CLIENT_SECRET to browser-side JS.
        */
        const tokenResponse =
            await fetch(
                EPIC_TOKEN_URL,
                {
                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded",

                        "Authorization":
                            "Basic " +
                            btoa(
                                `${clientId}:${clientSecret}`
                            )
                    },

                    body:
                        new URLSearchParams({
                            grant_type:
                                "authorization_code",

                            code,

                            redirect_uri:
                                redirectUri
                        })
                }
            );


        console.info(
            "EPIC CALLBACK SERVICE: Token response received.",
            {
                debugId,

                status:
                    tokenResponse.status,

                ok:
                    tokenResponse.ok
            }
        );


        /*
        Epic rejected the authorization-code exchange.
        */
        if (
            !tokenResponse.ok
        ) {

            const tokenError =
                await tokenResponse.text();


            console.error(
                "EPIC CALLBACK SERVICE: Token exchange failed.",
                {
                    debugId,

                    status:
                        tokenResponse.status,

                    response:
                        limitMessage(
                            tokenError
                        )
                }
            );


            return json(
                {
                    success: false,

                    message:
                        "Token exchange failed.",

                    upstreamStatus:
                        tokenResponse.status,

                    debugId
                },
                502
            );
        }


        /*
        =====================================================
        5. VALIDATE TOKEN RESPONSE
        =====================================================
        */

        const tokenData =
            await tokenResponse.json();


        /*
        Epic may include the authenticated account ID in the
        token response.

        Keep this as a fallback in case the user-info response
        identifies the account using another property.
        */
        const tokenAccountId =
            typeof tokenData.account_id ===
            "string"
                ? tokenData.account_id.trim()
                : "";


        const accessToken =
            typeof tokenData.access_token ===
            "string"
                ? tokenData.access_token.trim()
                : "";


        console.info(
            "EPIC CALLBACK SERVICE: Token exchange completed.",
            {
                debugId,

                hasAccessToken:
                    Boolean(
                        accessToken
                    ),

                hasTokenAccountId:
                    Boolean(
                        tokenAccountId
                    ),

                tokenType:
                    tokenData.token_type ||
                    null,

                expiresIn:
                    tokenData.expires_in ||
                    null
            }
        );


        /*
        A successful HTTP response without an access token
        is still unusable.
        */
        if (
            !accessToken
        ) {

            console.error(
                "EPIC CALLBACK SERVICE: Access token missing.",
                {
                    debugId
                }
            );


            return json(
                {
                    success: false,

                    message:
                        "Epic returned no access token.",

                    debugId
                },
                502
            );
        }


        /*
        =====================================================
        6. REQUEST EPIC USER INFORMATION
        =====================================================
        */

        const profileResponse =
            await fetch(
                EPIC_USER_INFO_URL,
                {
                    method:
                        "GET",

                    headers: {
                        "Authorization":
                            `Bearer ${accessToken}`,

                        "Accept":
                            "application/json"
                    }
                }
            );


        console.info(
            "EPIC CALLBACK SERVICE: Profile response received.",
            {
                debugId,

                status:
                    profileResponse.status,

                ok:
                    profileResponse.ok
            }
        );


        /*
        Do not attempt to parse/use the profile if Epic
        rejected the user-info request.
        */
        if (
            !profileResponse.ok
        ) {

            const profileError =
                await profileResponse.text();


            console.error(
                "EPIC CALLBACK SERVICE: Profile request failed.",
                {
                    debugId,

                    status:
                        profileResponse.status,

                    response:
                        limitMessage(
                            profileError
                        )
                }
            );


            return json(
                {
                    success: false,

                    message:
                        "Failed to fetch Epic profile.",

                    upstreamStatus:
                        profileResponse.status,

                    debugId
                },
                502
            );
        }


        /*
        =====================================================
        7. PARSE EPIC PROFILE
        =====================================================
        */

        const profile =
            await profileResponse.json();


        /*
        Log only the property names returned by Epic.

        Do NOT dump the entire profile or token into logs.
        */
        console.info(
            "EPIC CALLBACK SERVICE: Profile shape received.",
            {
                debugId,

                keys:
                    Object.keys(
                        profile || {}
                    )
            }
        );


        /*
        Support the most likely identity fields while keeping
        the token account ID as a fallback.

        We intentionally do NOT use an empty string fallback
        as a valid identity.
        */
        const epicAccountId =
            (
                typeof profile?.id ===
                "string"
                    ? profile.id

                    : typeof profile?.sub ===
                      "string"
                        ? profile.sub

                        : tokenAccountId
            ).trim();


        /*
        Display name is useful but is not used as the
        authoritative account identifier.

        Account ID remains the unique identity.
        */
        const displayName =
            (
                typeof profile?.displayName ===
                "string"
                    ? profile.displayName

                    : typeof profile?.preferred_username ===
                      "string"
                        ? profile.preferred_username

                        : ""
            ).trim();


        console.info(
            "EPIC CALLBACK SERVICE: Epic identity resolved.",
            {
                debugId,

                hasAccountId:
                    Boolean(
                        epicAccountId
                    ),

                hasDisplayName:
                    Boolean(
                        displayName
                    ),

                accountIdSource:
                    typeof profile?.id ===
                    "string" &&
                    profile.id.trim()
                        ? "profile.id"

                        : typeof profile?.sub ===
                          "string" &&
                          profile.sub.trim()
                            ? "profile.sub"

                            : tokenAccountId
                                ? "token.account_id"

                                : null
            }
        );


        /*
        =====================================================
        8. REQUIRE A VALID EPIC ACCOUNT
        =====================================================
        */

        /*
        This is important.

        Previously the callback would create:

        {
            epicAccountId: "",
            displayName: "Epic Player"
        }

        and still consider that user authenticated.

        That is no longer permitted.
        */
        if (
            !epicAccountId
        ) {

            console.error(
                "EPIC CALLBACK SERVICE: Valid Epic identity was not returned.",
                {
                    debugId,

                    profileKeys:
                        Object.keys(
                            profile || {}
                        ),

                    tokenHasAccountId:
                        Boolean(
                            tokenAccountId
                        )
                }
            );


            return json(
                {
                    success: false,

                    message:
                        "Epic authentication returned no account identity.",

                    debugId
                },
                502
            );
        }


        /*
        =====================================================
        9. VERIFY SESSION STORAGE EXISTS
        =====================================================
        */

        if (
            !env.AUTH_SESSIONS
        ) {

            console.error(
                "EPIC CALLBACK SERVICE: AUTH_SESSIONS binding missing.",
                {
                    debugId
                }
            );


            return json(
                {
                    success: false,

                    message:
                        "Session storage is unavailable.",

                    debugId
                },
                500
            );
        }


        /*
        =====================================================
        10. CREATE BPD SESSION
        =====================================================
        */

        /*
        Create an opaque random session ID.

        The browser receives only this session ID.

        Epic account information remains server-side in
        AUTH_SESSIONS.
        */
        const sessionId =
            crypto.randomUUID();


        const sessionKey =
            `session:${sessionId}`;


        /*
        This is the server-side session object.

        Additional registration/account information can be
        added later, but the authenticated Epic account ID
        should remain the primary identity field.
        */
        const sessionData = {

            epicAccountId,

            displayName:
                displayName ||
                "Epic Player",

            createdAt:
                Date.now()
        };


        /*
        =====================================================
        OPTIONAL DATABASE REGISTRATION CHECK
        =====================================================

        Later, this is where you can:

        1. Search your registered-user database using
           epicAccountId.

        2. Determine whether this Epic account has completed
           BPD registration.

        3. Store/update the user's Epic information.

        Example future idea:

        const user =
            await findUserByEpicAccountId(
                env,
                epicAccountId
            );

        const registrationComplete =
            Boolean(
                user?.registrationComplete
            );

        For now, authentication and registration remain
        separate.
        */


        /*
        Store session in Cloudflare KV / AUTH_SESSIONS.

        KV key:
        session:<random-session-id>

        It automatically expires after SESSION_TTL.
        */
        await env.AUTH_SESSIONS.put(
            sessionKey,
            JSON.stringify(
                sessionData
            ),
            {
                expirationTtl:
                    SESSION_TTL
            }
        );


        console.info(
            "EPIC CALLBACK SERVICE: Session stored.",
            {
                debugId,

                sessionTtl:
                    SESSION_TTL,

                hasEpicAccountId:
                    true,

                hasDisplayName:
                    Boolean(
                        displayName
                    )
            }
        );


        /*
        =====================================================
        11. CREATE BROWSER SESSION COOKIE
        =====================================================
        */

        const cookie =
            createCookie(
                request,
                AUTH_SESSION_COOKIE,
                sessionId,
                SESSION_TTL
            );


        /*
        Do not place the Epic access token in this cookie.

        The browser only receives your random BPD session ID.
        */
        if (
            !cookie
        ) {

            console.error(
                "EPIC CALLBACK SERVICE: Session cookie creation failed.",
                {
                    debugId
                }
            );


            /*
            Clean up the session because there is no usable
            browser cookie to reference it.
            */
            await env.AUTH_SESSIONS.delete(
                sessionKey
            );


            return json(
                {
                    success: false,

                    message:
                        "Failed to create login session.",

                    debugId
                },
                500
            );
        }


        /*
        =====================================================
        12. REDIRECT AUTHENTICATED USER
        =====================================================
        */

        /*
        For now, every successfully authenticated Epic user
        goes back to Rocket League.

        Once registration checking is added, this can become:

        registrationComplete
            ? "/RocketLeague"
            : "/RocketLeague/Register";
        */
        const redirectDestination =
            "/RocketLeague";


        console.info(
            "EPIC CALLBACK SERVICE: Completed successfully.",
            {
                debugId,

                cookieCreated:
                    true,

                redirectDestination
            }
        );


        return redirect(
            redirectDestination,
            [
                cookie
            ]
        );

    } catch (error) {

        /*
        =====================================================
        UNEXPECTED FAILURE
        =====================================================

        Anything reaching this block was not one of the
        expected OAuth/API validation failures above.
        */
        console.error(
            "EPIC CALLBACK SERVICE: Unexpected failure.",
            {
                debugId,

                name:
                    error?.name ||
                    "Error",

                message:
                    error?.message ||
                    "Unknown error",

                stack:
                    error?.stack ||
                    null
            }
        );


        return json(
            {
                success: false,

                message:
                    "Epic callback failed unexpectedly.",

                debugId
            },
            500
        );
    }
}