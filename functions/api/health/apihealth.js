export async function onRequestGet() {
    return Response.json(
        {
            success:
                true
        },
        {
            status:
                200,

            headers: {
                "Cache-Control":
                    "no-store"
            }
        }
    );
}