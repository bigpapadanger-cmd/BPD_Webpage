export function json(data, status = 200, extraHeaders = {}) {
    const safeStatus = Number.isInteger(status) ? status : 200;
    const body = JSON.stringify(data ?? {});
    const headers = {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...extraHeaders
    };
    return new Response(body, { status: safeStatus, headers });
}

export function redirect(location, cookieHeaders = []) {
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
