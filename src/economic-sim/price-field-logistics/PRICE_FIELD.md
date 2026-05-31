# Price Field

The price field is the experiment's alternative to global pathfinding and global
market scanning.

## Sources

The field is logistics' model of the market, not a world-level demand field.
Sources come from logistics' running estimate of residual product demand:

- unfilled consumer product bids,
- consumer product bids filled by logistics.

The estimate stores a source price (`fieldBid`) and volume (`bidVolume`) on each
cell. Both are updated as a running average after auctions clear. A high latent
consumer bid does not directly become a field source; it first has to show up
as actual market behavior in the local order history.

## Propagation

The field updates incrementally. Each simulation tick advances the existing
field by one automaton step from the previous residual-demand estimate instead
of rebuilding and flooding the whole map.

Signals decay as they move. Cells retain directional message state so price
information can spread over time without requiring a full search from every
source every turn.

## Logistics Use

Logistics treats the field as a directional gradient:

- A neighboring cell with a stronger field signal can justify moving product one
  tile toward it.
- A strong local or diffused signal can justify bidding for producer product.
- The field is not a guaranteed clearing price.

Actual trades still clear only through local auctions. The field is a planning
signal, not a substitute for the market.

## Future Direction

The field experiment is most useful if display and debugging tools make clear
which values are ledger balances, which values are local market state, and which
values are propagated signals. The UI should move toward ledger-backed
inspection and away from treating denormalized cell mirrors as independent
truth.
