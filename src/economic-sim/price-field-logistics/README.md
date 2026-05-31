# Price-Field Logistics Experiment

The experiment asks whether local product bids can propagate as a spatial price
field, and whether logistics can move goods one tile at a time along that field
while producers and consumers keep using ordinary local markets.

## Main Loop

Initialization happens once in `scenario.ts`: it seeds the grid, agents, and
initial ledger balances.

Each simulation tick then roughly does this:

1. `engine.ts` clones the prior state and refreshes balance mirrors from the ledger.
2. `agents.ts` supplies policy hooks for adaptive local prices and logistics field sources.
3. The product bid field advances one incremental step from logistics' residual-demand estimate.
4. `agents.ts` policies act through `PriceAgentApi`.
5. The engine clears local `product` and `labor` auctions.
6. The engine runs configured recipes against same-agent, same-account balances.
7. The UI renders the resulting state and ledger-derived summaries.

## Source Of Truth

The ledger is the balance source of truth. It stores balances by:

`agent -> account -> resource`

Ledger-backed display values such as consumer money, producer stock, farm food,
and logistics stock are derived in `uiData.ts`, not stored on cells. `fieldBid`
and `bidVolume` are different: they are logistics' running estimate of residual
product demand, maintained by `agents.ts` from auction outcomes.

Agent policies should use `PriceAgentApi` instead of reading the backing cell
array.
