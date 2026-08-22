export function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...extraHeaders
        }
    });
}

export function redirect(location, cookieHeaders = []) {
    const headers = new Headers({
        "location": location,
        "cache-control": "no-store"
    });

    cookieHeaders.forEach(c => headers.append("set-cookie", c));

    return new Response(null, { status: 302, headers });
}
