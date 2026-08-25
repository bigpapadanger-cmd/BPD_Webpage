var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/pages-rTJ7NR/functionsWorker-0.989746598524736.mjs
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
function json(data, status = 200, extraHeaders = {}) {
  const safeStatus = Number.isInteger(status) ? status : 200;
  const body = JSON.stringify(data ?? {});
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  };
  return new Response(body, { status: safeStatus, headers });
}
__name(json, "json");
__name2(json, "json");
function redirect(location, cookieHeaders = []) {
  const safeLocation = typeof location === "string" ? location : "/";
  const headers = new Headers({
    "location": safeLocation,
    "cache-control": "no-store"
  });
  for (const c of cookieHeaders) {
    if (typeof c === "string" && c.includes("=")) headers.append("set-cookie", c);
  }
  return new Response(null, { status: 302, headers });
}
__name(redirect, "redirect");
__name2(redirect, "redirect");
var EPIC_AUTHORIZE_URL = "https://www.epicgames.com/id/authorize";
var EPIC_TOKEN_URL = "https://api.epicgames.dev/epic/oauth/v2/token";
var EPIC_USER_INFO_URL = "https://api.epicgames.dev/epic/oauth/v2/userInfo";
var AUTH_STATE_COOKIE = "bpd_epic_state";
var AUTH_SESSION_COOKIE = "bpd_session";
var AUTH_STATE_MAX_AGE_SECONDS = 600;
var SESSION_DURATION_HOURS = 24;
var SESSION_TTL_SECONDS = SESSION_DURATION_HOURS * 3600;
function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  if (!header.includes("=")) return "";
  const cookies = header.split(";");
  for (const cookie of cookies) {
    const [n, v] = cookie.split("=").map((x) => x.trim());
    if (n === name && typeof v === "string") {
      try {
        return decodeURIComponent(v);
      } catch {
        return "";
      }
    }
  }
  return "";
}
__name(getCookie, "getCookie");
__name2(getCookie, "getCookie");
function createCookie(request, name, value, maxAgeSeconds) {
  const safeName = typeof name === "string" ? name.trim() : "";
  const safeValue = typeof value === "string" ? value.trim() : "";
  const safeMaxAge = Number.isInteger(maxAgeSeconds) ? maxAgeSeconds : 0;
  if (!safeName) return "";
  const url = new URL(request.url);
  const parts = [
    `${safeName}=${encodeURIComponent(safeValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${safeMaxAge}`
  ];
  if (url.protocol === "https:") {
    parts.push("Secure");
  }
  return parts.join("; ");
}
__name(createCookie, "createCookie");
__name2(createCookie, "createCookie");
async function getStoredSession(request, env) {
  const sessionId = getCookie(request, "bpd_session");
  if (!sessionId || sessionId.length < 5) {
    return null;
  }
  const key = `session:${sessionId}`;
  const data = await env.AUTH_SESSIONS.get(key, "json");
  if (!data || typeof data !== "object") {
    return null;
  }
  return {
    sessionId,
    sessionData: data
  };
}
__name(getStoredSession, "getStoredSession");
__name2(getStoredSession, "getStoredSession");
var SESSION_TTL = SESSION_TTL_SECONDS;
function maskClientId(clientId) {
  if (!clientId || clientId.length < 10) {
    return "missing-or-invalid";
  }
  return `${clientId.slice(0, 6)}...${clientId.slice(-4)}`;
}
__name(maskClientId, "maskClientId");
__name2(maskClientId, "maskClientId");
function limitMessage(value) {
  return String(value || "").replace(/\s+/g, " ").slice(0, 500);
}
__name(limitMessage, "limitMessage");
__name2(limitMessage, "limitMessage");
async function handleEpicCallback(request, env) {
  const debugId = crypto.randomUUID();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  console.info(
    "EPIC CALLBACK SERVICE: Started.",
    {
      debugId,
      method: request.method,
      pathname: url.pathname,
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasOAuthError: url.searchParams.has("error")
    }
  );
  try {
    if (!code || !state) {
      console.error(
        "EPIC CALLBACK SERVICE: OAuth parameters missing.",
        {
          debugId,
          hasCode: Boolean(code),
          hasState: Boolean(state),
          oauthError: url.searchParams.get("error"),
          oauthErrorDescription: limitMessage(
            url.searchParams.get(
              "error_description"
            )
          )
        }
      );
      return json(
        {
          success: false,
          message: "Missing OAuth parameters.",
          debugId
        },
        400
      );
    }
    const storedState = getCookie(
      request,
      AUTH_STATE_COOKIE
    );
    console.info(
      "EPIC CALLBACK SERVICE: State checked.",
      {
        debugId,
        hasStoredState: Boolean(storedState),
        stateMatches: Boolean(
          storedState && storedState === state
        )
      }
    );
    if (!storedState || storedState !== state) {
      console.error(
        "EPIC CALLBACK SERVICE: OAuth state invalid.",
        {
          debugId,
          hasStoredState: Boolean(storedState)
        }
      );
      return json(
        {
          success: false,
          message: "Invalid OAuth state.",
          debugId
        },
        400
      );
    }
    const clientId = typeof env.EPIC_CLIENT_ID === "string" ? env.EPIC_CLIENT_ID.trim() : "";
    const clientSecret = typeof env.EPIC_CLIENT_SECRET === "string" ? env.EPIC_CLIENT_SECRET.trim() : "";
    const redirectUri = typeof env.EPIC_REDIRECT_URI === "string" ? env.EPIC_REDIRECT_URI.trim() : "";
    console.info(
      "EPIC CALLBACK SERVICE: Configuration loaded.",
      {
        debugId,
        clientId: maskClientId(clientId),
        hasClientSecret: Boolean(clientSecret),
        redirectUri,
        tokenUrl: EPIC_TOKEN_URL,
        userInfoUrl: EPIC_USER_INFO_URL,
        hasSessionBinding: Boolean(env.AUTH_SESSIONS)
      }
    );
    if (!clientId || !clientSecret || !redirectUri) {
      console.error(
        "EPIC CALLBACK SERVICE: Configuration invalid.",
        {
          debugId,
          hasClientId: Boolean(clientId),
          hasClientSecret: Boolean(clientSecret),
          hasRedirectUri: Boolean(redirectUri)
        }
      );
      return json(
        {
          success: false,
          message: "Epic callback configuration invalid.",
          debugId
        },
        500
      );
    }
    console.info(
      "EPIC CALLBACK SERVICE: Starting token exchange.",
      {
        debugId,
        clientId: maskClientId(clientId),
        redirectUri
      }
    );
    const tokenResponse = await fetch(
      EPIC_TOKEN_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + btoa(
            `${clientId}:${clientSecret}`
          )
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri
        })
      }
    );
    console.info(
      "EPIC CALLBACK SERVICE: Token response received.",
      {
        debugId,
        status: tokenResponse.status,
        ok: tokenResponse.ok
      }
    );
    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      console.error(
        "EPIC CALLBACK SERVICE: Token exchange failed.",
        {
          debugId,
          status: tokenResponse.status,
          response: limitMessage(tokenError)
        }
      );
      return json(
        {
          success: false,
          message: "Token exchange failed.",
          upstreamStatus: tokenResponse.status,
          debugId
        },
        502
      );
    }
    const tokenData = await tokenResponse.json();
    const accessToken = typeof tokenData.access_token === "string" ? tokenData.access_token : "";
    console.info(
      "EPIC CALLBACK SERVICE: Token exchange completed.",
      {
        debugId,
        hasAccessToken: Boolean(accessToken),
        tokenType: tokenData.token_type || null,
        expiresIn: tokenData.expires_in || null
      }
    );
    if (!accessToken) {
      console.error(
        "EPIC CALLBACK SERVICE: Access token missing.",
        {
          debugId
        }
      );
      return json(
        {
          success: false,
          message: "Epic returned no access token.",
          debugId
        },
        502
      );
    }
    const profileResponse = await fetch(
      EPIC_USER_INFO_URL,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json"
        }
      }
    );
    console.info(
      "EPIC CALLBACK SERVICE: Profile response received.",
      {
        debugId,
        status: profileResponse.status,
        ok: profileResponse.ok
      }
    );
    if (!profileResponse.ok) {
      const profileError = await profileResponse.text();
      console.error(
        "EPIC CALLBACK SERVICE: Profile request failed.",
        {
          debugId,
          status: profileResponse.status,
          response: limitMessage(profileError)
        }
      );
      return json(
        {
          success: false,
          message: "Failed to fetch Epic profile.",
          upstreamStatus: profileResponse.status,
          debugId
        },
        502
      );
    }
    const profile = await profileResponse.json();
    console.info(
      "EPIC CALLBACK SERVICE: Profile loaded.",
      {
        debugId,
        hasAccountId: Boolean(profile.id),
        hasDisplayName: Boolean(profile.displayName)
      }
    );
    if (!env.AUTH_SESSIONS) {
      console.error(
        "EPIC CALLBACK SERVICE: AUTH_SESSIONS binding missing.",
        {
          debugId
        }
      );
      return json(
        {
          success: false,
          message: "Session storage is unavailable.",
          debugId
        },
        500
      );
    }
    const sessionId = crypto.randomUUID();
    const sessionKey = `session:${sessionId}`;
    const sessionData = {
      epicAccountId: profile.id || "",
      displayName: profile.displayName || "Epic Player",
      createdAt: Date.now()
    };
    await env.AUTH_SESSIONS.put(
      sessionKey,
      JSON.stringify(sessionData),
      {
        expirationTtl: SESSION_TTL
      }
    );
    console.info(
      "EPIC CALLBACK SERVICE: Session stored.",
      {
        debugId,
        sessionTtl: SESSION_TTL
      }
    );
    const cookie = createCookie(
      request,
      AUTH_SESSION_COOKIE,
      sessionId,
      SESSION_TTL
    );
    console.info(
      "EPIC CALLBACK SERVICE: Completed successfully.",
      {
        debugId,
        cookieCreated: Boolean(cookie),
        redirectDestination: "/RocketLeague"
      }
    );
    return redirect(
      "/RocketLeague",
      [cookie]
    );
  } catch (error) {
    console.error(
      "EPIC CALLBACK SERVICE: Unexpected failure.",
      {
        debugId,
        name: error?.name || "Error",
        message: error?.message || "Unknown error",
        stack: error?.stack || null
      }
    );
    return json(
      {
        success: false,
        message: "Epic callback failed unexpectedly.",
        debugId
      },
      500
    );
  }
}
__name(handleEpicCallback, "handleEpicCallback");
__name2(handleEpicCallback, "handleEpicCallback");
async function onRequest(context) {
  const debugId = crypto.randomUUID();
  const requestUrl = new URL(context.request.url);
  console.info(
    "EPIC CALLBACK ROUTE: Request received.",
    {
      debugId,
      method: context.request.method,
      pathname: requestUrl.pathname,
      hasCode: requestUrl.searchParams.has("code"),
      hasState: requestUrl.searchParams.has("state"),
      hasError: requestUrl.searchParams.has("error")
    }
  );
  try {
    const response = await handleEpicCallback(
      context.request,
      context.env
    );
    console.info(
      "EPIC CALLBACK ROUTE: Request completed.",
      {
        debugId,
        status: response.status,
        location: response.headers.get("location")
      }
    );
    return response;
  } catch (error) {
    console.error(
      "EPIC CALLBACK ROUTE: Unexpected failure.",
      {
        debugId,
        name: error?.name || "Error",
        message: error?.message || "Unknown error",
        stack: error?.stack || null
      }
    );
    return Response.json(
      {
        success: false,
        message: "Epic callback failed unexpectedly.",
        debugId
      },
      {
        status: 500
      }
    );
  }
}
__name(onRequest, "onRequest");
__name2(onRequest, "onRequest");
function createRandomState() {
  return crypto.randomUUID();
}
__name(createRandomState, "createRandomState");
__name2(createRandomState, "createRandomState");
function getMissingAuthConfiguration(env) {
  const missing = [];
  if (!env.EPIC_CLIENT_ID) missing.push("EPIC_CLIENT_ID");
  if (!env.EPIC_CLIENT_SECRET) missing.push("EPIC_CLIENT_SECRET");
  if (!env.EPIC_REDIRECT_URI) missing.push("EPIC_REDIRECT_URI");
  return missing;
}
__name(getMissingAuthConfiguration, "getMissingAuthConfiguration");
__name2(getMissingAuthConfiguration, "getMissingAuthConfiguration");
function maskClientId2(clientId) {
  if (!clientId || clientId.length < 10) {
    return "missing-or-invalid";
  }
  return `${clientId.slice(0, 6)}...${clientId.slice(-4)}`;
}
__name(maskClientId2, "maskClientId2");
__name2(maskClientId2, "maskClientId");
async function handleEpicLogin(request, env) {
  const debugId = crypto.randomUUID();
  console.info(
    "EPIC LOGIN SERVICE: Started.",
    {
      debugId,
      method: request.method,
      pathname: new URL(request.url).pathname
    }
  );
  try {
    const missing = getMissingAuthConfiguration(env);
    console.info(
      "EPIC LOGIN SERVICE: Configuration checked.",
      {
        debugId,
        missing: Array.isArray(missing) ? missing : []
      }
    );
    if (Array.isArray(missing) && missing.length > 0) {
      console.error(
        "EPIC LOGIN SERVICE: Configuration missing.",
        {
          debugId,
          missing
        }
      );
      return json(
        {
          success: false,
          message: "Epic OAuth configuration is incomplete.",
          missing,
          debugId
        },
        503
      );
    }
    const clientId = typeof env.EPIC_CLIENT_ID === "string" ? env.EPIC_CLIENT_ID.trim() : "";
    const redirectUri = typeof env.EPIC_REDIRECT_URI === "string" ? env.EPIC_REDIRECT_URI.trim() : "";
    console.info(
      "EPIC LOGIN SERVICE: OAuth values loaded.",
      {
        debugId,
        clientId: maskClientId2(clientId),
        redirectUri,
        authorizeUrl: EPIC_AUTHORIZE_URL,
        stateCookie: AUTH_STATE_COOKIE,
        stateMaxAge: AUTH_STATE_MAX_AGE_SECONDS
      }
    );
    if (!clientId || !redirectUri) {
      console.error(
        "EPIC LOGIN SERVICE: OAuth values invalid.",
        {
          debugId,
          hasClientId: Boolean(clientId),
          hasRedirectUri: Boolean(redirectUri)
        }
      );
      return json(
        {
          success: false,
          message: "Epic OAuth configuration invalid.",
          debugId
        },
        500
      );
    }
    let parsedRedirectUri;
    try {
      parsedRedirectUri = new URL(redirectUri);
    } catch (error) {
      console.error(
        "EPIC LOGIN SERVICE: Redirect URI invalid.",
        {
          debugId,
          redirectUri,
          message: error.message
        }
      );
      return json(
        {
          success: false,
          message: "Epic OAuth redirect URI is invalid.",
          debugId
        },
        500
      );
    }
    const state = createRandomState();
    if (!state || typeof state !== "string") {
      console.error(
        "EPIC LOGIN SERVICE: State generation failed.",
        {
          debugId
        }
      );
      return json(
        {
          success: false,
          message: "Failed to generate OAuth state.",
          debugId
        },
        500
      );
    }
    console.info(
      "EPIC LOGIN SERVICE: State generated.",
      {
        debugId,
        stateLength: state.length
      }
    );
    const url = new URL(EPIC_AUTHORIZE_URL);
    url.searchParams.set(
      "client_id",
      clientId
    );
    url.searchParams.set(
      "response_type",
      "code"
    );
    url.searchParams.set(
      "redirect_uri",
      redirectUri
    );
    url.searchParams.set(
      "scope",
      "basic_profile presence"
    );
    url.searchParams.set(
      "state",
      state
    );
    console.info(
      "EPIC LOGIN SERVICE: Redirect prepared.",
      {
        debugId,
        epicOrigin: url.origin,
        epicPathname: url.pathname,
        clientId: maskClientId2(clientId),
        redirectOrigin: parsedRedirectUri.origin,
        redirectPathname: parsedRedirectUri.pathname,
        scope: url.searchParams.get("scope")
      }
    );
    const cookie = createCookie(
      request,
      AUTH_STATE_COOKIE,
      state,
      AUTH_STATE_MAX_AGE_SECONDS
    );
    console.info(
      "EPIC LOGIN SERVICE: Redirecting to Epic.",
      {
        debugId,
        cookieCreated: Boolean(cookie)
      }
    );
    return redirect(
      url.toString(),
      [cookie]
    );
  } catch (error) {
    console.error(
      "EPIC LOGIN SERVICE: Unexpected failure.",
      {
        debugId,
        name: error?.name || "Error",
        message: error?.message || "Unknown error",
        stack: error?.stack || null
      }
    );
    return json(
      {
        success: false,
        message: "Epic login initialization failed.",
        debugId
      },
      500
    );
  }
}
__name(handleEpicLogin, "handleEpicLogin");
__name2(handleEpicLogin, "handleEpicLogin");
async function onRequest2(context) {
  const debugId = crypto.randomUUID();
  const requestUrl = new URL(context.request.url);
  console.info(
    "EPIC LOGIN ROUTE: Request received.",
    {
      debugId,
      method: context.request.method,
      pathname: requestUrl.pathname
    }
  );
  try {
    const response = await handleEpicLogin(
      context.request,
      context.env
    );
    console.info(
      "EPIC LOGIN ROUTE: Request completed.",
      {
        debugId,
        status: response.status,
        hasLocation: response.headers.has(
          "location"
        ),
        locationOrigin: getLocationOrigin(
          response.headers.get(
            "location"
          )
        )
      }
    );
    return response;
  } catch (error) {
    console.error(
      "EPIC LOGIN ROUTE: Unexpected failure.",
      {
        debugId,
        name: error?.name || "Error",
        message: error?.message || "Unknown error",
        stack: error?.stack || null
      }
    );
    return Response.json(
      {
        success: false,
        message: "Epic login failed unexpectedly.",
        debugId
      },
      {
        status: 500
      }
    );
  }
}
__name(onRequest2, "onRequest2");
__name2(onRequest2, "onRequest");
function getLocationOrigin(location) {
  if (!location) {
    return null;
  }
  try {
    return new URL(location).origin;
  } catch {
    return "invalid-location";
  }
}
__name(getLocationOrigin, "getLocationOrigin");
__name2(getLocationOrigin, "getLocationOrigin");
async function handleRocketLeagueProfile(request, env) {
  const storedSession = await getStoredSession(
    request,
    env
  );
  if (!storedSession) {
    return json(
      {
        success: false,
        authenticated: false,
        message: "Login is required to load Rocket League ranks."
      },
      401
    );
  }
  const sessionData = storedSession.sessionData;
  const username = String(
    sessionData.rocketLeagueLookup?.username || sessionData.displayName || ""
  ).trim();
  if (!username || username.length < 2) {
    return json(
      {
        success: false,
        authenticated: true,
        message: "Invalid Rocket League username in session."
      },
      400
    );
  }
  const platform = String(
    sessionData.rocketLeagueLookup?.platform || "epic"
  ).trim().toLowerCase();
  const allowedPlatforms = [
    "psn",
    "xbl",
    "steam",
    "epic",
    "switch"
  ];
  if (!allowedPlatforms.includes(platform)) {
    return json(
      {
        success: false,
        authenticated: true,
        message: "Invalid Rocket League platform in session."
      },
      400
    );
  }
  return json(
    {
      success: false,
      authenticated: true,
      temporarilyUnavailable: true,
      username,
      platform,
      message: "Rocket League profile lookup is temporarily unavailable."
    },
    503
  );
}
__name(handleRocketLeagueProfile, "handleRocketLeagueProfile");
__name2(handleRocketLeagueProfile, "handleRocketLeagueProfile");
async function onRequest3(context) {
  return handleRocketLeagueProfile(context.request, context.env);
}
__name(onRequest3, "onRequest3");
__name2(onRequest3, "onRequest");
async function handleRocketLeagueSession(request, env) {
  const session = await getStoredSession(request, env);
  if (!session) {
    return new Response(
      JSON.stringify({
        authenticated: false,
        user: null
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
  const user = session.sessionData?.user || null;
  return new Response(
    JSON.stringify({
      authenticated: true,
      user
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}
__name(handleRocketLeagueSession, "handleRocketLeagueSession");
__name2(handleRocketLeagueSession, "handleRocketLeagueSession");
async function onRequest4(context) {
  return handleRocketLeagueSession(context.request, context.env);
}
__name(onRequest4, "onRequest4");
__name2(onRequest4, "onRequest");
async function handleOCRLocalize(request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) {
      return new Response(
        JSON.stringify({ error: "Missing file upload" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const buffer = await file.arrayBuffer();
    const localizeResponse = await fetch(env.OCR_LOCALIZE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-api-key": env.OCR_API_KEY
      },
      body: buffer
    });
    if (!localizeResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Localization provider failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    const result = await localizeResponse.json();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Localization failed", details: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(handleOCRLocalize, "handleOCRLocalize");
__name2(handleOCRLocalize, "handleOCRLocalize");
async function onRequest5(context) {
  return handleOCRLocalize(context.request, context.env);
}
__name(onRequest5, "onRequest5");
__name2(onRequest5, "onRequest");
async function onRequest6({ request, env }) {
  const body = await request.text();
  const response = await fetch(env.OCR_TRACKING_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" }
  });
  return response;
}
__name(onRequest6, "onRequest6");
__name2(onRequest6, "onRequest");
async function handleOCRRequest(request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) {
      return new Response(
        JSON.stringify({ error: "Missing file upload" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const buffer = await file.arrayBuffer();
    const ocrResponse = await fetch(env.OCR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-api-key": env.OCR_API_KEY
      },
      body: buffer
    });
    if (!ocrResponse.ok) {
      return new Response(
        JSON.stringify({ error: "OCR provider failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    const result = await ocrResponse.json();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "OCR request failed", details: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
__name(handleOCRRequest, "handleOCRRequest");
__name2(handleOCRRequest, "handleOCRRequest");
async function onRequest7(context) {
  return handleOCRRequest(context.request, context.env);
}
__name(onRequest7, "onRequest7");
__name2(onRequest7, "onRequest");
var routes = [
  {
    routePath: "/api/auth/epic/callback",
    mountPath: "/api/auth/epic",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/api/auth/epic/epic_login",
    mountPath: "/api/auth/epic",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/api/auth/rocketleague/profile",
    mountPath: "/api/auth/rocketleague",
    method: "",
    middlewares: [],
    modules: [onRequest3]
  },
  {
    routePath: "/api/auth/rocketleague/session",
    mountPath: "/api/auth/rocketleague",
    method: "",
    middlewares: [],
    modules: [onRequest4]
  },
  {
    routePath: "/api/ocr/localize",
    mountPath: "/api/ocr",
    method: "",
    middlewares: [],
    modules: [onRequest5]
  },
  {
    routePath: "/api/ocr/localTracking",
    mountPath: "/api/ocr",
    method: "",
    middlewares: [],
    modules: [onRequest6]
  },
  {
    routePath: "/api/ocr",
    mountPath: "/api/ocr",
    method: "",
    middlewares: [],
    modules: [onRequest7]
  }
];
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
__name2(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name2(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name2(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name2(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name2(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name2(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
__name2(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
__name2(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name2(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
__name2(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
__name2(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
__name2(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
__name2(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
__name2(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
__name2(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
__name2(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");
__name2(pathToRegexp, "pathToRegexp");
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
__name2(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name2(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name2(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name2((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
var drainBody = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
__name2(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
__name2(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
__name2(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");
__name2(__facade_invoke__, "__facade_invoke__");
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  static {
    __name(this, "___Facade_ScheduledController__");
  }
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name2(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name2(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name2(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
__name2(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name2((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name2((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
__name2(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default2 = drainBody2;

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError2(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError2(e.cause)
  };
}
__name(reduceError2, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError2(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default2 = jsonError2;

// .wrangler/tmp/bundle-ZIGoGd/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__2 = [
  middleware_ensure_req_body_drained_default2,
  middleware_miniflare3_json_error_default2
];
var middleware_insertion_facade_default2 = middleware_loader_entry_default;

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__2 = [];
function __facade_register__2(...args) {
  __facade_middleware__2.push(...args.flat());
}
__name(__facade_register__2, "__facade_register__");
function __facade_invokeChain__2(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__2(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__2, "__facade_invokeChain__");
function __facade_invoke__2(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__2(request, env, ctx, dispatch, [
    ...__facade_middleware__2,
    finalMiddleware
  ]);
}
__name(__facade_invoke__2, "__facade_invoke__");

// .wrangler/tmp/bundle-ZIGoGd/middleware-loader.entry.ts
var __Facade_ScheduledController__2 = class ___Facade_ScheduledController__2 {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__2)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler2(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__2(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__2(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler2, "wrapExportedHandler");
function wrapWorkerEntrypoint2(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__2(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__2(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint2, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY2;
if (typeof middleware_insertion_facade_default2 === "object") {
  WRAPPED_ENTRY2 = wrapExportedHandler2(middleware_insertion_facade_default2);
} else if (typeof middleware_insertion_facade_default2 === "function") {
  WRAPPED_ENTRY2 = wrapWorkerEntrypoint2(middleware_insertion_facade_default2);
}
var middleware_loader_entry_default2 = WRAPPED_ENTRY2;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__2 as __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default2 as default
};
//# sourceMappingURL=functionsWorker-0.989746598524736.js.map
