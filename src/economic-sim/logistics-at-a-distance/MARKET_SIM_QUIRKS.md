# Market Simulation Quirks

This note is for agents that need to interact with the market simulation without
assuming more machinery than the engine actually provides. It describes the sim
contract and edge cases only; it intentionally avoids strategy advice.

## World And Accounts

- The world is a `24 x 16` grid.
- Physical accounts are string coordinates in the form `"x,y"`.
- The empty string account, `""`, is the abstract money account.
- `parseAccount("")` returns `null`, so anything requiring a physical location
  must use a coordinate account.
- Ledger balances are partitioned by agent first, then account, then resource.
  Agents do not share a global inventory at a cell.
- Consumer agents are named `Consumer-x,y`, one per populated cell, so each
  population has its own money balance.
- Logistics agents are named `Logistics-n`; each has its own money and widget
  balances.
- Missing ledger entries read as zero.

## Resources

The sim currently tracks:

- `money`
- `widget`
- `factory`
- `population`

Orders can only trade `widget`. Money is only used as the payment resource.
Factories and population are not traded by the market; they are cell-local
endowments that drive turn-by-turn generation.

## Turn Order

Each `stepSimulation` call does the following in order:

1. Clone the prior ledger.
2. Generate resources for every agent.
3. Run each agent policy once in a freshly randomized order.
4. Clear all orders placed during that turn.
5. Refund all unfilled reserves.
6. Return the next immutable-ish `SimState` snapshot.

Generation happens before any agent acts:

- Each `factory` unit owned by an agent creates `5` widgets for that same agent
  in that same physical account.
- Each `population` unit owned by an agent creates `6` money for that same agent
  in the agent's abstract money account.

## Order Placement

Placing an order immediately reserves balances from the cloned turn ledger:

- Bids reserve `quantity * price` money from the agent's abstract money account.
- Asks reserve `quantity` widgets from the specified physical account.
- Quantity `0` orders are ignored and do not consume an order id.
- Prices and quantities must be non-negative safe integers.
- A reserve that would overdraw throws instead of clipping.

Order ids are monotonically assigned as orders are accepted. These ids matter for
tie-breaking during clearing.

## Market Clearing

The market clears independently per account. This has several consequences:

- A bid at one cell cannot match an ask at another cell.
- Non-physical accounts are skipped during clearing.
- Orders are grouped only by account, not by resource, because current orders are
  widget-only.
- Bids sort by highest price first, then lowest order id.
- Asks sort by lowest price first, then lowest order id.
- A trade occurs while the best bid price is at least the best ask price.
- The execution price is the midpoint between the bid and ask prices, equivalent
  to a `k = 0.5` double-auction price rule.
- Because balances are integer-only, odd bid/ask spreads round to the nearest
  integer with JavaScript's positive-number `Math.round` behavior.
- Buyers receive widgets at the traded cell account.
- Sellers receive money in the abstract money account.
- If a bid crossed above the execution price, the buyer receives the difference
  between the reserved bid amount and the midpoint payment as a refund.

After clearing, any remaining bid reserves and ask reserves are returned. Order
results report original quantity, filled quantity, and unfilled quantity.

## Transport

Transport is not delayed. A successful request moves widgets during the policy
run, before market clearing:

- `from === to` is ignored.
- Quantity `0` is ignored.
- Only widgets can be transported.
- Both endpoints must be physical coordinate accounts.
- Unit cost is the floating value `manhattanDistance / 3`.
- Total cost for a positive transport is `max(1, ceil(quantity * unitCost))`.
- Requested quantity is clipped by available widgets and affordable money.
- Transport reserves widgets from the source and money from the abstract money
  account, then immediately credits widgets to the destination.
- Transport costs are removed from the ledger rather than paid to another agent.

Because transport mutates the same turn ledger used for later orders, transported
widgets can be asked at the destination in the same turn if the policy does so
after requesting transport.

## Agent Logic

Policy-specific behavior lives in `AGENT_LOGIC.md`. Keep this file focused on
engine and market mechanics.

## Observation Scope

The API exposes two cell-scanning helpers:

- `cellsWith(resource)` returns the current agent's positive balances for that
  resource on physical accounts only.
- `observeCells(agent, resource)` does the same for another named agent.

Both helpers exclude the abstract money account. They also omit zero balances,
which means absence from the result is equivalent to "not positive", not
necessarily "no ledger key exists".

`lastOrderResults` contains only the calling agent's prior-turn order results.
The engine filters by identity before exposing it to the policy.

`publicLastOrderResults` in the policy context contains prior-turn order results
for all agents. Use it for public market observations like unmet local bids;
keep `lastOrderResults` for private own-order feedback.

`lastTrades` contains the prior turn's public trades for all agents. Trades
record cell coordinates, buyer, seller, quantity, and midpoint execution price.

## Visualization

Display-specific behavior lives in `VISUALIZATION.md`. Nothing in the UI should
be treated as a separate source of simulation truth.

## Tooling

Use `pnpm` for project commands in this repository. Prefer focused checks like
`pnpm test` while iterating; `pnpm run build` is useful for broader validation
but does not need to run after every small edit.

## Validation Footguns

- All arithmetic goes through safe-integer checks. Negative values, fractions,
  `Infinity`, `NaN`, and unsafe integers throw.
- `reserveBalance` throws if the reserve would make a balance negative.
- `parseAccount` accepts any integer pair string, even outside the displayed grid;
  grid bounds are enforced by scenario/UI usage rather than the account parser.
- The account string must parse to two integers. Malformed account strings become
  non-physical accounts and will not clear as markets.
- There is no partial reserve failure for orders. If the full requested reserve is
  unavailable, order placement throws.
