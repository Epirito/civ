# Agents

Agents interact with the experiment through `PriceAgentApi`. The API is
account-oriented: policies can inspect balances, local market metadata, open
orders, and field signals, but they do not receive the backing `cells` array or
the mutable simulation state.

## Consumer Swarm

Each populated cell has a consumer agent named `Consumer-x,y`.

Consumers:

- Place local `product` bids when they have money.
- Define effective product bids by capping local willingness by local money.
- Define affordable product demand volume from population and budget.
- Place local `labor` asks from their available labor stock.
- Earn money only by selling labor.

Product demand is therefore population-backed and budget-limited.

## Producer

The producer is a global agent with money in the abstract money account.

The producer:

- Evaluates configured recipes at each cell.
- Checks durable recipe requirements, such as `factory`, without spending them.
- Bids for missing market-traded recipe inputs when expected output revenue
  beats expected input cost.
- Places local `labor` bids using a cell-local adaptive bid.
- Raises local labor bids after missed producer bids and lowers them after
  clean fills.
- Receives inputs through local markets.
- Gets recipe outputs from the generation step when inputs and requirements are
  present in the same account.
- Places local `product` asks for product it owns at factory cells.

The producer's expected product revenue may use latent local willingness and the
diffused bid field. That is a planning signal, not guaranteed realized demand.

## Logistics

Logistics owns money and product inventories.

Logistics:

- Bids for producer product when expected downstream value exceeds local ask.
- Moves owned product one tile at a time along the bid-field gradient.
- Places local product asks where consumer demand can buy the product.
- Maintains the price-field sources as a running estimate of residual product
  demand from unfilled consumer bids and bids it personally filled.

Movement is not a market order. It is an API action that spends logistics money
and creates moved stock for the destination cell.

## API Boundary

Policies iterate physical accounts with `api.accounts()`, then call
`api.local(account)` for non-balance market metadata such as local willingness,
population, and factory ask price. Balances come from `api.balance` and
`api.balanceOf`; live order-book signals come from `api.bestBid` and
`api.bestAsk`.

This keeps the ledger and order book as the market source of truth. The local
metadata is scenario state, not an inventory substitute.

Adaptive local prices, funded demand calculations, and logistics field-source
updates are agent behavior. The engine receives those decisions as hooks so the
world mechanics do not present a policy model as a built-in property of the
world.
