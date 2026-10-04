# Rocket League Item Shop Source Audit

Snapshot: 2026-10-03. This combines upstream protocol and local implementation
review. The protected MMR Worker exposes normalized global shop data, and the
existing DomainData hourly Worker hashes/saves snapshots through the confirmed
live write RPC. The live cached read RPC, server endpoint, and public carousel
are implemented. No Supabase schema change or deployment was made.

## Upstream source and trust boundary

The supplied [dank/rlapi README](https://github.com/dank/rlapi/blob/master/README.md)
describes a reverse-engineered Go SDK, not an anonymous supported public shop
feed. Its authentication path goes through Epic/EOS and PsyNet's authenticated
WebSocket. The shop RPCs execute on that authenticated session. Do not put its
credentials/session tokens in DomainData browser code or return authenticated
raw responses to clients.

The MMR Worker endpoint requires its existing backend bearer key and uses the
current Durable Object's authenticated PsyNet session. The two Shop RPCs take no
player ID and do not request wallet or inventory. DomainData calls this endpoint
only from its hourly background job; the browser never contacts the MMR Worker.
The Admin capability entry remains informational; it does not trigger Shop
refreshes or provider calls.

## Shop RPCs inspected

| PsyNet method | Session / player context | Input | Useful response fields evidenced by `shops.go` and `REQUESTS.md` | Refresh contribution |
| --- | --- | --- | --- | --- |
| `Shops/GetStandardShops v1` | Authenticated PsyNet WebSocket required. No `PlayerID` or `localPlayerID` in the RPC request. | Empty object. | Shop `ID`, `Type`, `StartDate`, nullable `EndDate`, nullable `LogoURL`, `Name`, `Title`. IDs/types identify sections, but the semantic meaning of every type is not documented. | First of two required RPCs; discover current shop IDs and section metadata. |
| `Shops/GetShopCatalogue v2` | Same authenticated socket; no player ID in request. | `ShopIDs: [...]`. | Catalogue `ShopID`; `ShopItems` include `ShopItemID`, start/end times, nullable `ImageURL`, `Title`, `Description`, deliverable product IDs/attributes/count, delivery currencies, costs/prices, reset/end times, item locations, and some purchase/ownership/quantity flags. | Second required RPC; one call can request the discovered current shop IDs. |
| `Shops/GetShopNotifications v1` | Same authenticated socket; empty object. | Empty object. | Notification/cost identifiers, start/end times, nullable image, title, deliverable products. The SDK type and README example disagree on object-vs-array shape. | Optional third call only if a notification/featured-promotion UI is required; not needed for the basic rotating catalogue. |
| `Shops/GetPlayerWallet v1` | Authenticated local player; request explicitly uses `localPlayerID`. | Player ID. | Currency IDs and account-specific balances/timestamps/flags. | Not needed; exclude wallet entirely. |

One minimal shop snapshot therefore requires **two PsyNet RPCs** after session
authentication; requesting notifications adds one. The total login/bootstrap
HTTP exchange count is variable because token acquisition/refresh and Epic-to-EOS
exchange paths depend on the provisioned credentials. The RPC methods themselves
do not accept a target player ID, but `AuthPlayer` does establish a player-scoped
session. A dedicated service account is still required for that authentication
session even though shop requests contain no local player argument.

No `Products` RPC in `products.go` is a general public ProductID-to-metadata
lookup: `GetPlayerProducts` is the authenticated player's inventory, while the
other inspected methods concern drops, entitlement status, or item mutations.
`Microtransaction/GetCatalog` in `REQUESTS.md` is a player-scoped starter-pack
catalogue and is not the rotating shop catalogue. It is not needed for the basic
shop read and no purchase method is in scope.

## Fields safe to consider for normalized public data

The shop/catalogue contracts evidence section/shop IDs, section type and names,
item IDs, item title/description, start/end times, optional image URL, product
IDs/attributes, currency IDs and amounts, price entries, and cost/item reset/end
times. Timestamps shown by examples are Unix seconds. `ImageURL` and `LogoURL`
are nullable; the catalogue example has a null item image, so artwork coverage
is not guaranteed. Use an image only when an upstream field contains a valid,
approved image URL; otherwise render a clean no-artwork state. Do not construct
CDN paths or infer names/artwork from ProductID. The current SDK/docs do not
establish a public product metadata resolver.

Several fields are inappropriate for a public snapshot and should be dropped:
`IsOwned`, `PurchasedQuantity`, daily purchase counts, account wallet values,
session/player identity, raw auth/PsyNet/session tokens, request IDs, and all
purchase/mutation affordances. Currency IDs are present, but the inspected shop
schema does not itself provide a verified display-name mapping; expose a human
label only after separately verifying that mapping. Product attributes may
contain variant metadata; whitelist only attributes needed for display.

`ShopItemLocations` and `DisplayTypeID` exist as integers, but their complete
meaning is not established here. Do not label these as named categories without
an authoritative mapping. Shop `Type`/`Name`/`Title` are better section sources
when present.

## Connection lifecycle conclusion

The shop methods require a live authenticated PsyNet WebSocket while the RPCs
run. The SDK's `AuthPlayer` creates that socket, starts a ping/keepalive loop,
and `PsyNetRPC.Close()` closes the socket and stops the ping timer. It does not
establish that one socket must stay alive between rotations. The existing MMR
Durable Object already owns a long-lived authenticated session, so the approved
implementation reuses it for this global, no-player-ID read rather than adding a
second Gateway/runtime. This does not make the MMR Worker a per-user history
source: its session identity remains the Worker service account.

## Current scheduled and public-read implementation

The existing `bpd-rl-presence-monitor` hourly cron starts the Shop refresh as a
separate job from per-player refresh. DomainData calls the protected
`/get-shop-data` endpoint once per hour; that endpoint makes the two RPCs above
and returns normalized data. DomainData computes a canonical SHA-256 over the
normalized sections/catalogues, calls `api.save_rl_shop_snapshot`, then records
`shop` success/change through `api.record_rl_global_refresh_result`. An
unchanged hash is a successful refresh with `changed=false`; provider/save
failures preserve the last saved snapshot. This is 24 scheduled opportunities
per day and two PsyNet reads per opportunity, with no page-triggered polling.
The scheduler does not yet use item end-times to alter its hourly cadence.

The live read contract is `api.get_rl_current_shop()` with `available`,
`snapshotId`, `contentHash`, `providerSchemaVersion`, `capturedAt`, `shops`,
`catalogues`, and `notifications`. DomainData calls this RPC only from
`functions/services/supabase/rocketleague/current_shop.js`, through the
service-role credential. The public `GET /api/rocketleague/shop` returns a
bounded allowlist and caches successful responses for 60 seconds in browsers
and 300 seconds at shared edge caches. Failures return a generic, uncached
response. No database diagnostics, session information, or unapproved provider
fields are returned.

The public `/RocketLeague/Shop` page loads that DomainData endpoint once when its
page module initializes. It displays saved section/item data in a responsive
carousel with previous/next controls, section and item timing, optional verified
HTTPS artwork, and known numeric currency IDs (not guessed currency names).
Snapshots older than two hours (one missed hourly refresh) or whose displayed
sections have all expired are labeled as potentially out of date while remaining
available to browse. All text is inserted as text, not HTML. Missing snapshots,
empty catalogues, and missing artwork have explicit fallback states. It does not
wake the MMR Worker or call Rocket League on page views. Purchases, wallet
information, and inventory state remain out of scope.

## Proposed contracts for a later approved implementation

### Normalized stored snapshot

```json
{
  "captured_at": "ISO-8601 UTC",
  "valid_until": "ISO-8601 UTC or null",
  "content_hash": "sha256 of canonical public payload",
  "sections": [
    {
      "id": "provider shop id as string",
      "type": "provider section type or null",
      "name": "verified shop name/title or null",
      "starts_at": "ISO-8601 UTC or null",
      "ends_at": "ISO-8601 UTC or null",
      "items": [
        {
          "id": "provider shop item id as string",
          "name": "provider title or null",
          "description": "provider description or null",
          "price": [{ "currency_id": 13, "amount": 1500 }],
          "starts_at": "ISO-8601 UTC or null",
          "ends_at": "ISO-8601 UTC or null",
          "reset_at": "ISO-8601 UTC or null",
          "image_url": "verified upstream URL or null",
          "products": [{ "product_id": 11499, "count": 1, "attributes": [] }]
        }
      ]
    }
  ]
}
```

Only include `price`, `products`, and attributes after allow-list normalization;
the sample is a proposed public-safe projection, not a claim every response has
those values. `valid_until` should be the earliest verified future end/reset
across displayed sections/items, or null. The source/capture time is generated
by the background service, not copied from a provider field.

### Persistence/cache

The live `api.save_rl_shop_snapshot` and `api.get_rl_current_shop` contracts are
available. The background-only writer saves normalized shops/catalogues, an
empty notifications array (the optional notification RPC is not called), schema
version 1, capture timestamp, and content hash. The public endpoint calls the
read RPC server-side and returns only a bounded allowlist. No table/schema, RLS,
grants, or RPC were changed in this pass.

### DomainData and UI

The public cached read endpoint and carousel are implemented. Refine the public
projection only against a confirmed provider payload; do not add arbitrary
provider fields or direct browser database access.

## Operator requirements and open dependencies

- The current implementation uses the existing MMR Worker's authenticated
  session only for the global shop methods that accept no player ID. Revisit this
  choice if provider policy requires a dedicated shop identity.
- A supported/current game build and PsyNet signing/session implementation; the
  SDK README warns these are reverse-engineered and can become stale.
- Egress support for Epic/EOS HTTPS and authenticated PsyNet WebSocket.
- Current Shop read/write RPC and server-role grants are confirmed; any future
  schema, grants, or RPC changes require separate review and approval.
- Validate whether the provider's image URLs are currently populated and
  browser-accessible; present asset nulls safely.
- The page currently displays section/item dates in the visitor's local timezone;
  shop type semantics are still not mapped, so do not label types as daily,
  featured, or another named category without an authoritative mapping.
