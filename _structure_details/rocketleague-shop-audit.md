# Rocket League Item Shop Source Audit

Snapshot: 2026-10-02. This remains a source review of the upstream shop
protocol. DomainData now has a public `/RocketLeague/Shop` information page,
but no shop service, endpoint, data ingestion, or live inventory UI. No
Supabase change, MMR Worker change, or deployment was made.

## Upstream source and trust boundary

The supplied [dank/rlapi README](https://github.com/dank/rlapi/blob/master/README.md)
describes a reverse-engineered Go SDK, not an anonymous supported public shop
feed. Its authentication path goes through Epic/EOS and PsyNet's authenticated
WebSocket. The shop RPCs execute on that authenticated session. Do not put its
credentials/session tokens in DomainData browser code or return authenticated
raw responses to clients.

The repository exposes an informational Admin capability placeholder for
`item-shop.read`. The public Shop page states that live data is not yet
available; it does not call a provider or display fabricated inventory. The
current MMR Worker remains explicitly out of scope.

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
and `PsyNetRPC.Close()` closes the socket and stops the ping timer. The SDK does
not establish that one socket must stay alive between shop rotations. Therefore
a scheduled job can authenticate, fetch the two shop responses, normalize and
persist them, then close the socket; it does **not** need a continuously running
Gateway-like socket owner between scheduled executions. The session must remain
alive during both requests, and a short-lived scheduler/runtime must support
outbound WebSockets. This is a conclusion about the inspected SDK lifecycle,
not a guarantee about future provider-side policy or token/session behavior.

## Recommended future design (not implemented)

Use a separate Google Cloud Run Job invoked by Cloud Scheduler. It should own a
dedicated operator-approved Epic/EOS account's server-side refresh credentials,
open one PsyNet session per run, call `GetStandardShops` then one
`GetShopCatalogue` for current public shop IDs, normalize an allow-listed public
snapshot, compare a canonical content hash, persist only when changed, and close
the socket. This remains separate from MMR/Skills and does not run from page
views.

Use item/cost/section end times and cost reset times as refresh hints. Because
shop-level `EndDate` can be null and all timing fields can change, schedule a
conservative **30-minute fallback** while a shop is active, with a single
deduplicated refresh when the earliest verified item/cost expiry is approaching
(for example, schedule near expiry but not more than once per 30-minute safety
window). If no usable future expiry exists, remain on the 30-minute fallback.
This is 48 scheduled opportunities/day, but only two RPCs per opportunity; the
content hash prevents unchanged database writes. Reduce frequency if observed
rotation windows are longer, and measure upstream limits before increasing it.
Do not run a high-frequency countdown poll.

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

Preferred later contract: one current snapshot record/table, keyed by a constant
shop dataset name, containing normalized JSON, `captured_at`, `valid_until`,
`content_hash`, and last-success/error metadata. A background-only writer uses a
service identity; a public-safe read RPC/API returns only the current normalized
payload and freshness metadata. No individual account/wallet/inventory data is
stored. A history table is unnecessary unless the product later asks for shop
rotation history.

This would require explicit approval before changing Supabase: a new snapshot
table (or an explicitly approved existing cache contract), write/read RPCs,
RLS, and grants. Alternative Cloudflare KV/R2 persistence would require a
separate authenticated ingestion boundary and Pages binding changes. No choice
has been applied.

### DomainData and UI

Future public `GET /api/rocketleague/shop` should read only the cached snapshot,
return `{ success, captured_at, valid_until, stale, sections }`, set an
appropriate short public cache header, and never initialize/wake the background
service. If the current provider read is unavailable, return the last-known
snapshot with `stale: true`; if none exists, return a clean unavailable payload.
The homepage card can navigate sections/items client-side without additional
provider requests. Its freshness label should make stale data visible.

## Operator requirements and open dependencies

- A separately managed Epic/EOS account and its approved server-side refresh
  credential/token lifecycle. Do not use an end user's credential or the MMR
  Worker's account without explicit authorization.
- A supported/current game build and PsyNet signing/session implementation; the
  SDK README warns these are reverse-engineered and can become stale.
- Egress support for Epic/EOS HTTPS and authenticated PsyNet WebSocket.
- Approved storage choice and grants before persistence/API work.
- Validate whether the provider's image URLs are currently populated and
  browser-accessible; present asset nulls safely.
- Confirm whether the website should show shop section dates/timezone and which
  shop types count as the main daily shop, since shop type semantics can vary.

No shop provider service or homepage carousel was added in this pass because no
existing isolated service skeleton exists and the requested provider-service
work was explicitly deferred.
