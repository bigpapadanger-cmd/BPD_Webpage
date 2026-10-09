const OCR_PUBLIC_CODE = /^[A-Z0-9]{16}$/;
const REVIEW_DESTINATIONS = Object.freeze({
    "profile.complete": "/RocketLeague/Profile",
    "provider.reauthorize": "/Account?reauthorize=epic"
});

export function getNotificationReviewDestination(reviewAction, reviewCode = null, origin = "https://bpd-gaming-network.com") {
    if (reviewAction === "ocr.review" && OCR_PUBLIC_CODE.test(reviewCode || "")) {
        const destination = new URL("/RocketLeague/SubmitMatchResults", origin);
        destination.searchParams.set("jobId", reviewCode);
        return `${destination.pathname}${destination.search}`;
    }
    return Object.hasOwn(REVIEW_DESTINATIONS, reviewAction) ? REVIEW_DESTINATIONS[reviewAction] : null;
}
