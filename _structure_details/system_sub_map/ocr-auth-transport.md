# OCR Authentication and Transport Sub-map

Snapshot: 2026-09-28

## Callers and contracts

1. `functions/api/ocr/jobs/submit_job.js` validates/submits the request, stores
   job/image data in R2, and enqueues the existing `bpd-ocr-jobs` message.
2. `workers/ocr-job-consumer/src/index.js` calls the Pages process callback;
   its concurrency, retries, acknowledgements, and cleanup remain unchanged.
3. `functions/api/ocr/jobs/process_job.js` loads R2 data, constructs the same
   multipart OCR request, calls `OCR_GOOGLE_TRANSPORT`, validates the provider
   JSON, and persists existing results/progress/candidate archives.
4. `functions/services/ocr/handler.js` performs its existing user/session,
   Epic, and owner-field validation, then uses the same transport for its
   synchronous OCR call.
5. `functions/api/ocr/compare.js` remains on the Pages auth helper pending
   confirmation of its separate `OCR_API_TEST_URL` target.

## Worker contract

Pages calls the `OCR_GOOGLE_TRANSPORT` Service Binding with only
`POST /api/ocr`, multipart body, and the optional validated job/handler headers.
The Worker does not accept caller-selected destinations, Google audiences,
service accounts, STS/IAM endpoints, or arbitrary routes. It validates the
image field and limits body/image to 16 MiB/15 MiB and response to 2 MiB. The
15 MiB image bound matches the current Cloud Run upload limit; queued Pages
submissions remain separately bounded to 10 MiB at ingress.

The transport Worker performs mTLS X.509 STS exchange, obtains a federated
access token, mints the Cloud Run ID token, and calls the configured fixed
Cloud Run URL with `Authorization`, `X-API-Key`, multipart bytes, and OCR job
metadata. It returns the bounded Cloud Run status/body/content type, not Google
tokens. Auth failures use existing `OCR_GOOGLE_STS_EXCHANGE_FAILED` and
`OCR_GOOGLE_ID_TOKEN_FAILED` codes; provider network/timeout/oversized response
errors use `OCR_PROVIDER_TRANSPORT_FAILED`, `OCR_PROVIDER_TIMEOUT`, and
`OCR_PROVIDER_RESPONSE_TOO_LARGE`.

The authenticated `GET /health` Service Binding endpoint is separate from
`POST /api/ocr`. It performs no Google STS/IAM or Cloud Run operation and
returns only booleans indicating required configuration presence. It uses the
same shared-secret authorization. The Admin system-status aggregator uses this
route with a short timeout and a 45-second cache.

## Security/configuration

`workers/ocr-cloud-run-proxy/wrangler.jsonc` has no workers.dev URL, preview
URL, queue, or schedule. It has the `ocr-transport.bpd-gaming-network.com`
custom domain, gated by `OCR_GOOGLE_TRANSPORT_SECRET`. Pages' Service Binding
remains the normal caller boundary; the shared secret is never sent to browser
code and rejected requests do not trigger Google or Cloud Run calls. The Worker
secrets are `OCR_GCP_X509_CERT_CHAIN`, `OCR_API_KEY`, and
`OCR_GOOGLE_TRANSPORT_SECRET`; the latter must also be a Pages secret.
Tokens are isolate-memory cached by the shared auth helper with expiry skew;
no token is persisted or logged. The root Pages config retains its mTLS binding
only for the admin diagnostic route and the un-migrated comparison endpoint.

## Operator sequence (not executed)

1. Set `OCR_GOOGLE_TRANSPORT_SECRET` on Pages and the Worker to the same
   operator-generated high-entropy value, set the X.509 chain and API key on
   the Worker, and deploy `bpd-ocr-cloud-run-proxy` with the documented config.
   The custom hostname must be available in the Cloudflare zone.
2. Confirm the root Pages service binding targets that Worker in the intended
   Pages environment.
3. Deploy Pages after the Worker exists.
4. The operator performs runtime smoke tests; this code change does not deploy
   or call live Google/Cloud Run services.

The known-good diagnostic evidence (`/probe/empty`, `/probe/full-sts`, and
`/probe/id-token` succeeded) is recorded in the diagnostic Worker README. The
diagnostic Worker remains temporary and reference-only.
