# DomainData System Map

Snapshot: 2026-09-28

## Runtime overview

- `public/` is the browser-delivered site and calls the same-origin Pages API.
- `functions/api/` contains Cloudflare Pages routes; reusable server logic is
  under `functions/services/`.
- `workers/` contains independently configured Cloudflare Workers.
- `ocr_cloudData/` is a separate Google Cloud Run Python OCR service and is
  ignored by Git as intended.

## OCR execution

Browser -> Pages OCR submission -> R2 + queue -> `workers/ocr-job-consumer/`
-> Pages `functions/api/ocr/jobs/process_job.js` -> internal Pages binding
`OCR_GOOGLE_TRANSPORT` -> `workers/ocr-cloud-run-proxy/` -> Google mTLS STS
-> IAM Credentials `generateIdToken` -> fixed Cloud Run OCR endpoint
-> Pages result persistence and progress -> browser polling.

The synchronous `/api/ocr` handler uses the same internal transport after
Pages-side session, Epic, and ownership validation. Google credentials remain
inside the transport Worker and are not returned to Pages or the browser.
`workers/google-mtls-diagnostic/` remains temporary/reference-only. The
authenticated `/api/ocr/compare` endpoint remains a separate Pages auth caller
because it has a second, not-yet-documented Cloud Run test target. The
admin-only `/api/ocr/debug/mtls-probe` remains a diagnostic-only direct binding
probe and is not used for normal processing.

## Configuration ownership

- Root `wrangler.jsonc` owns Pages bindings, including
  `OCR_GOOGLE_TRANSPORT -> bpd-ocr-cloud-run-proxy`.
- `workers/ocr-cloud-run-proxy/wrangler.jsonc` owns its fixed Cloud Run target,
  Google WIF identifiers, mTLS binding, timeout, and secret-gated custom domain.
  `OCR_GCP_X509_CERT_CHAIN`, `OCR_API_KEY`, and
  `OCR_GOOGLE_TRANSPORT_SECRET` are Worker secrets, not repository values. The
  transport secret is also configured as a Pages secret.
- `workers/ocr-job-consumer/wrangler.jsonc` owns OCR queue consumption and
  continues to call the Pages process endpoint. Its queue, retry, and cleanup
  behavior is unchanged.
- `workers/google-mtls-diagnostic/` is not part of production job execution.

See [OCR authentication sub-map](system_sub_map/ocr-auth-transport.md) for the
transport contract, boundaries, and operator sequence.
