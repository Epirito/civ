# Market Model

This prototype has its own lightweight local market model. It deliberately uses
the same basic accounting shape as the main sim, but with experiment-specific
resources and behavior.

## Ledger

`PriceLedger` stores balances as:

`agent -> account -> resource -> amount`

Agents do not share balances just because they occupy the same cell. A consumer,
the producer, and logistics can all hold different resources at the same
physical account.

The empty account `""` is the abstract money account. Cell accounts use
coordinate strings like `"3,4"`.

## Resources

Tracked resources:

- `money`
- `product`
- `labor`
- `factory`

Market-traded resources:

- `product`
- `labor`

Money is the payment resource. It is reserved for bids and paid to sellers when
orders clear.

## Generation

After auctions clear, the engine runs configured recipes over the whole ledger.
Each recipe has:

- `inputs`: consumed resources.
- `requirements`: required resources that limit production but are not consumed.
- `outputs`: produced resources.

For every `(agent, account)`, the engine computes how many times each recipe can
run from that account's inputs and requirements, consumes the inputs, and adds
the outputs. The current default recipe consumes `labor`, requires `factory`,
and outputs `product`.

## Local Auctions

Orders clear independently by `(account, resource)`.

- Bids reserve `quantity * price` money immediately.
- Asks reserve `quantity` of the asked resource immediately.
- Bids sort highest price first, then earlier order id.
- Asks sort lowest price first, then earlier order id.
- Trades execute while best bid is at least best ask.
- Execution price is the rounded midpoint between bid and ask.
- Buyers receive the resource at the local account.
- Sellers receive money in the abstract money account.
- Unfilled bid reserves and ask reserves are refunded after clearing.

`lastOrderResults` records filled and unfilled quantity for every order from the
last clearing pass.

The cell also tracks separate local labor bid and ask history. Producer labor
bid fills/misses update `lastLaborBidFilled` and `lastLaborBidUnfilled`; consumer
labor ask fills/misses update `lastLaborFilled` and `lastLaborUnfilled`.

## Derived Cell Mirrors

The engine refreshes these cell fields from the ledger:

- `consumerMoney`
- `laborStock`
- `producerStock`
- `logisticsStock`

`fieldBid` and `bidVolume` are not ledger balances. They are logistics-agent
model state: a running estimate of residual consumer product demand. `agents.ts`
updates them from the previous auction pass using unfilled consumer product bids
and consumer product bids filled by logistics.

These mirrors are useful for rendering, but the ledger remains authoritative for
balances. Agent policies should inspect balances, open orders, and local market
metadata through `PriceAgentApi`; they should not use the backing cell array as
an inventory API.

The engine owns auction mechanics, reserves, refunds, balance updates, and
automaton stepping. It does not decide what an effective consumer bid is, how
adaptive prices change after filled or unfilled orders, or what should feed the
price field; those are agent policy choices.
