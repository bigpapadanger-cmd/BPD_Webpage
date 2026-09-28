# Google mTLS diagnostic Worker

Temporary, manually invoked diagnostics for the existing Cloudflare mTLS binding and Google X.509 Workload Identity Federation flow. This Worker has no cron, queue, retry, or background trigger. Each probe does only the outbound requests needed for that explicitly requested probe:

- `POST /probe/empty`: one direct mTLS request to Google STS, with an empty form body.
- `POST /probe/full-sts`: one direct mTLS STS exchange.
- `POST /probe/id-token`: one direct mTLS STS exchange followed by one service-account `generateIdToken` request. It reports whether a token was returned but never returns it.
- `GET /` or `GET /health`: protected binding/config presence check; no external request.

Every route requires `Authorization: Bearer <DIAGNOSTIC_BEARER_TOKEN>`. Use a unique, high-entropy value of at least 32 characters. Do not reuse the production OCR API key. Never put the bearer token or certificate chain in Git, command history, logs, or a deployment report.

After an operator-controlled deployment, set `$DiagnosticUrl` to the Worker URL shown by Wrangler and `$env:DIAGNOSTIC_BEARER_TOKEN` in that PowerShell session. Invoke only the specific probe needed:

```powershell
$Headers = @{ Authorization = "Bearer $env:DIAGNOSTIC_BEARER_TOKEN" }
Invoke-RestMethod -Method Post -Uri "$DiagnosticUrl/probe/empty" -Headers $Headers
Invoke-RestMethod -Method Post -Uri "$DiagnosticUrl/probe/full-sts" -Headers $Headers
# Optional only after STS succeeds:
Invoke-RestMethod -Method Post -Uri "$DiagnosticUrl/probe/id-token" -Headers $Headers
```

Each line makes exactly one HTTP request to this Worker. The empty/full STS probes each make one Google STS request; the optional ID-token probe makes one STS request and one IAM Credentials request. Avoid retry loops and do not run probes on a schedule. A failed request should be reviewed before manually trying it again.

## Required configuration

The checked-in Wrangler config contains only non-secret WIF identifiers and the existing Cloudflare mTLS certificate ID. Set these two Worker secrets before invoking probes:

- `DIAGNOSTIC_BEARER_TOKEN`: dedicated temporary endpoint access secret.
- `OCR_GCP_X509_CERT_CHAIN`: JSON array of base64 DER certificate-chain entries required by the configured Google X.509 provider.

`OCR_GCP_MTLS` is an mTLS binding, not a certificate secret. The configuration deliberately has no `OCR_GCP_SERVICE_ACCOUNT_JSON`, no private key, no service-account key file, and no automatic triggers. The ID-token probe additionally requires `iam.serviceAccounts.getOpenIdToken` on the configured service account for the federated caller (commonly granted using `roles/iam.serviceAccountOpenIdTokenCreator`). This is optional and not needed to isolate the STS mTLS handshake. I have not changed or checked live IAM policy.

## Local validation

From the repository root:

```powershell
npm run test:google-mtls-diagnostic
npx wrangler deploy --dry-run --config workers/google-mtls-diagnostic/wrangler.jsonc
```

The dry run bundles and validates configuration; it does not publish a Worker. Runtime probes require the operator to deploy/configure the diagnostic Worker and are intentionally not part of tests.

## Operator-controlled deployment (not run by this change)

First inspect the target account and current Wrangler support for version-scoped secrets. Do not use `wrangler secret put` for a staging step: that command immediately deploys a new version. Prefer uploading a version and attaching its secrets with Wrangler's version-scoped workflow, then deploy that exact version only when you choose. Keep the bearer token and certificate chain out of the repository; enter them only through Wrangler's hidden prompt or another approved secret-input path.

Create `workers/google-mtls-diagnostic/.dev.vars` locally (it is ignored by Git) with only these entries and their real values:

```powershell
DIAGNOSTIC_BEARER_TOKEN=<high-entropy temporary secret>
OCR_GCP_X509_CERT_CHAIN=<JSON array of base64 DER entries>
```

After verifying `.dev.vars` is ignored and contains no accidental whitespace/quotes, upload a version with those secrets but do not deploy it yet:

```powershell
npx wrangler versions upload --config workers/google-mtls-diagnostic/wrangler.jsonc --secrets-file workers/google-mtls-diagnostic/.dev.vars --message "temporary Google mTLS diagnostic"
```

Review Wrangler's output and the version in the Cloudflare dashboard. Only when you choose to publish, deploy the exact returned version ID:

```powershell
npx wrangler versions deploy <VERSION_ID>@100% --name bpd-google-mtls-diagnostic
```

The ordinary `wrangler secret put` and `wrangler deploy` shortcuts are intentionally not shown because they deploy immediately. Once investigation is complete, remove this Worker and its dedicated bearer secret through the operator's normal Cloudflare change process.

Do not call `/probe/id-token` unless STS has succeeded and that additional IAM token-mint check is needed. The diagnostic is not a proxy: it accepts no destination, audience, or token parameters from the caller.
