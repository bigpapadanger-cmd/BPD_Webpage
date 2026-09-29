# OCR Cloud Run transport Worker

`bpd-ocr-cloud-run-proxy` is the Pages Service Binding target for OCR requests.
It has no `workers.dev` or preview URL, queue, or schedule. It is attached to
`ocr-transport.bpd-gaming-network.com`; every request on that public hostname
is gated by a high-entropy shared secret. The normal Pages caller uses the
internal `OCR_GOOGLE_TRANSPORT` Service Binding and sends the same secret
server-to-server. Only `POST /api/ocr` is accepted, on either hostname.

The Worker validates a multipart image request, exchanges the configured X.509
subject token through `OCR_GCP_MTLS` for a federated Google access token, mints
a Cloud Run ID token, and forwards the original multipart bytes to the fixed
Cloud Run OCR URL. It returns only the bounded Cloud Run response, never either
Google token. Google credentials remain in isolate memory; no persistent token
storage or token logging is used.

Required Worker secrets (never commit values):

- `OCR_GCP_X509_CERT_CHAIN`
- `OCR_API_KEY`
- `OCR_GOOGLE_TRANSPORT_SECRET` (32–256 characters; configure the exact same
  value as a Pages secret)

Required Pages secret:

- `OCR_GOOGLE_TRANSPORT_SECRET`

Operator deployment steps (not run for this change):

```powershell
# Set the same high-entropy secret on the Worker and Pages. Generate/store it
# with your approved secret manager; never put it in source, Wrangler vars,
# command-line arguments, or logs.
npx wrangler secret put OCR_GOOGLE_TRANSPORT_SECRET --config workers/ocr-cloud-run-proxy/wrangler.jsonc
npx wrangler pages secret put OCR_GOOGLE_TRANSPORT_SECRET --project-name bpd-webpage

# Publish the Worker with the configured custom domain after reviewing the
# Wrangler config and confirming the hostname is available in the Cloudflare zone.
npx wrangler deploy --config workers/ocr-cloud-run-proxy/wrangler.jsonc

# Wrangler prompts for each value; enter certificate/API secrets interactively,
# never as command arguments.
npx wrangler secret put OCR_GCP_X509_CERT_CHAIN --config workers/ocr-cloud-run-proxy/wrangler.jsonc
npx wrangler secret put OCR_API_KEY --config workers/ocr-cloud-run-proxy/wrangler.jsonc

# Build and publish Pages only after the Worker and both secrets are in place.
npm run build
npx wrangler pages deploy public --project-name bpd-webpage
```

The custom domain is reachable publicly at the network layer, but requests
without the shared secret receive a generic 401 before Google or Cloud Run is
contacted. Do not expose the secret to browser code. The root `wrangler.jsonc`
adds `OCR_GOOGLE_TRANSPORT` pointing at this Worker. For the first smoke test,
submit one authorized OCR job through the
site, verify its existing progress/result polling completes, and confirm no
Google tokens appear in browser responses or logs. Do not call Cloud Run from
the browser. If the new Pages deployment must be rolled back, restore its
previous Cloudflare Pages deployment; there is no automatic auth fallback to
the known-failing Pages mTLS path. Re-enable OCR only after the Worker/Pages
binding has been corrected.

The prior Pages-side STS implementation remains in the shared auth helper only
for the separately scoped OCR comparison endpoint, but is not the queued or
direct OCR production transport. The admin-only Pages mTLS probe is diagnostic
only and is not called by OCR jobs.

The separate `workers/google-mtls-diagnostic/` Worker remains temporary. Its
`/probe/empty`, `/probe/full-sts`, and `/probe/id-token` probes succeeded and
provided the evidence for this production transport. It is not part of the
production request path.
