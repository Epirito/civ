export type FieldCoord = {
  x: number;
  y: number;
};

export type Direction = "north" | "east" | "south" | "west";

export type PriceFieldChannel = {
  sourceId: string;
  price: number;
  volume: number;
  parents: FieldCoord[];
};

export type DirectionalMessages = Record<Direction, PriceFieldChannel[]>;

export type PriceFieldCell = FieldCoord & {
  // Visible channels are derived from local source injection plus incoming
  // directed messages. They are ordered from strongest/highest-price to weakest.
  channels: PriceFieldChannel[];
  // Price mirrors the strongest visible channel for callers that only need one scalar.
  price: number;
  // Volume is total visible signal mass across retained channels.
  volume: number;
  // Parents are diagnostic contributors for the visible channels.
  parents: FieldCoord[];
  // Outgoing edge messages are the actual automaton state. Sending A -> B is
  // computed from A's local source plus incoming messages from every neighbor
  // except B, which prevents immediate self-echo.
  outgoing: DirectionalMessages;
};

export type PriceFieldSource = FieldCoord & {
  // Active sources inject fresh signal every step. Turning a source off leaves
  // existing directed messages to decay and propagate without new injection.
  price: number;
  volume: number;
  active: boolean;
};

export type PriceFieldState = {
  width: number;
  height: number;
  turn: number;
  cells: PriceFieldCell[];
};

export type PriceFieldOptions = {
  // Applied once per directed edge hop to the carried price signal.
  priceDecay: number;
  // Applied to volume once per directed edge hop.
  volumeDecay: number;
  // Contributions below this threshold are dropped so finite pulses disappear.
  minimumVolume?: number;
  // Maximum channels retained per visible cell and per outgoing edge.
  maxChannels?: number;
  // Same-source contributions within this fraction of their best price merge.
  closePriceRatio?: number;
  movementCost?: (from: FieldCoord, to: FieldCoord) => number;
};

const DEFAULT_MINIMUM_VOLUME = 0.0001;
const DEFAULT_MAX_CHANNELS = 4;
const DEFAULT_CLOSE_PRICE_RATIO = 0.85;

const DIRECTIONS: Array<{ direction: Direction; dx: number; dy: number; opposite: Direction }> = [
  { direction: "north", dx: 0, dy: -1, opposite: "south" },
  { direction: "east", dx: 1, dy: 0, opposite: "west" },
  { direction: "south", dx: 0, dy: 1, opposite: "north" },
  { direction: "west", dx: -1, dy: 0, opposite: "east" },
];

function emptyMessages(): DirectionalMessages {
  return {
    north: [],
    east: [],
    south: [],
    west: [],
  };
}

function sourceId(source: FieldCoord) {
  return `${source.x},${source.y}`;
}

export function createPriceFieldState(width: number, height: number): PriceFieldState {
  return {
    width,
    height,
    turn: 0,
    cells: Array.from({ length: height }, (_row, y) =>
      Array.from(
        { length: width },
        (_column, x): PriceFieldCell => ({
          x,
          y,
          channels: [],
          price: 0,
          volume: 0,
          parents: [],
          outgoing: emptyMessages(),
        }),
      ),
    ).flat(),
  };
}

export function fieldIndex(state: Pick<PriceFieldState, "width">, x: number, y: number) {
  return y * state.width + x;
}

export function fieldCell(state: PriceFieldState, x: number, y: number) {
  return state.cells[fieldIndex(state, x, y)];
}

export function fieldNeighbors(state: Pick<PriceFieldState, "width" | "height">, { x, y }: FieldCoord) {
  return DIRECTIONS.map(({ direction, dx, dy, opposite }) => ({
    direction,
    opposite,
    x: x + dx,
    y: y + dy,
  })).filter((coord) => coord.x >= 0 && coord.x < state.width && coord.y >= 0 && coord.y < state.height);
}

function passableNeighbors(
  state: Pick<PriceFieldState, "width" | "height">,
  cell: FieldCoord,
  movementCost?: PriceFieldOptions["movementCost"],
) {
  return fieldNeighbors(state, cell)
    .map((neighbor) => ({ ...neighbor, cost: movementCost?.(cell, neighbor) ?? 1 }))
    .filter((neighbor) => Number.isFinite(neighbor.cost) && neighbor.cost > 0);
}

type PendingContribution = {
  sourceId: string;
  parent: FieldCoord | null;
  price: number;
  volume: number;
};

function sourceKey(cell: FieldCoord) {
  return `${cell.x},${cell.y}`;
}

function indexSources(sources: PriceFieldSource[]) {
  const byCell = new Map<string, PriceFieldSource[]>();
  for (const source of sources) {
    if (!source.active) continue;
    const key = sourceKey(source);
    const cellSources = byCell.get(key) ?? [];
    cellSources.push(source);
    byCell.set(key, cellSources);
  }
  return byCell;
}

function localSourceContributions(sourceIndex: Map<string, PriceFieldSource[]>, cell: FieldCoord): PendingContribution[] {
  return (sourceIndex.get(sourceKey(cell)) ?? [])
    .map((source) => ({
      sourceId: sourceId(source),
      parent: null,
      price: source.price,
      volume: source.volume,
    }));
}

function incomingContributions(
  state: PriceFieldState,
  cell: FieldCoord,
  excludedIncomingDirection: Direction | null,
  movementCost?: PriceFieldOptions["movementCost"],
): PendingContribution[] {
  return passableNeighbors(state, cell, movementCost).flatMap((neighbor) => {
    if (neighbor.direction === excludedIncomingDirection) return [];
    return fieldCell(state, neighbor.x, neighbor.y).outgoing[neighbor.opposite].map((message) => ({
      ...message,
      parent: { x: neighbor.x, y: neighbor.y },
    }));
  });
}

function mergeContributions(
  contributions: PendingContribution[],
  maxChannels: number,
  closePriceRatio: number,
  minimumVolume: number,
): PriceFieldChannel[] {
  const bySource = new Map<string, PendingContribution[]>();
  for (const contribution of contributions) {
    if (contribution.volume < minimumVolume || contribution.price <= 0) continue;
    const sourceContributions = bySource.get(contribution.sourceId) ?? [];
    sourceContributions.push(contribution);
    bySource.set(contribution.sourceId, sourceContributions);
  }

  const mergedBySource = [...bySource.entries()].flatMap(([id, sourceContributions]) => {
    const sorted = [...sourceContributions].sort((a, b) => b.price - a.price);
    const best = sorted[0];
    if (!best) return [];
    const threshold = best.price * closePriceRatio;
    const close = sorted.filter((contribution) => contribution.price >= threshold);
    const volume = close.reduce((sum, contribution) => sum + contribution.volume, 0);
    if (volume < minimumVolume) return [];
    return [
      {
        sourceId: id,
        price: close.reduce((sum, contribution) => sum + contribution.price * contribution.volume, 0) / volume,
        volume,
        parents: close.flatMap((contribution) => (contribution.parent ? [contribution.parent] : [])),
      },
    ];
  });

  return mergedBySource.sort((a, b) => b.price - a.price).slice(0, maxChannels);
}

function decayChannels(
  channels: PriceFieldChannel[],
  parent: FieldCoord,
  priceDecay: number,
  volumeDecay: number,
  volumeShare: number,
  minimumVolume: number,
  movementCost: number,
): PriceFieldChannel[] {
  return channels.flatMap((channel) => {
    const price = channel.price * priceDecay ** movementCost;
    const volume = channel.volume * volumeDecay ** movementCost * volumeShare;
    if (price <= 0 || volume < minimumVolume) return [];
    return [{ ...channel, price, volume, parents: [parent] }];
  });
}

function visibleCell(cell: PriceFieldCell, channels: PriceFieldChannel[]): PriceFieldCell {
  const volume = channels.reduce((sum, channel) => sum + channel.volume, 0);
  return {
    ...cell,
    channels,
    price: channels[0]?.price ?? 0,
    volume,
    parents: channels.flatMap((channel) => channel.parents),
  };
}

export function stepPriceField(
  state: PriceFieldState,
  sources: PriceFieldSource[],
  {
    priceDecay,
    volumeDecay,
    minimumVolume = DEFAULT_MINIMUM_VOLUME,
    maxChannels = DEFAULT_MAX_CHANNELS,
    closePriceRatio = DEFAULT_CLOSE_PRICE_RATIO,
    movementCost,
  }: PriceFieldOptions,
): PriceFieldState {
  const sourceIndex = indexSources(sources);
  const nextCells = state.cells.map((cell): PriceFieldCell => {
    const local = localSourceContributions(sourceIndex, cell);
    const neighbors = passableNeighbors(state, cell, movementCost);
    const volumeShare = neighbors.length === 0 ? 0 : 1 / neighbors.length;
    const visibleChannels = mergeContributions(
      [...local, ...incomingContributions(state, cell, null, movementCost)],
      maxChannels,
      closePriceRatio,
      minimumVolume,
    );

    const outgoing = emptyMessages();
    for (const neighbor of neighbors) {
      const messageInputs = mergeContributions(
        [...local, ...incomingContributions(state, cell, neighbor.direction, movementCost)],
        maxChannels,
        closePriceRatio,
        minimumVolume,
      );
      outgoing[neighbor.direction] = decayChannels(
        messageInputs,
        cell,
        priceDecay,
        volumeDecay,
        volumeShare,
        minimumVolume,
        neighbor.cost,
      );
    }

    return {
      ...visibleCell(cell, visibleChannels),
      outgoing,
    };
  });

  return {
    ...state,
    turn: state.turn + 1,
    cells: nextCells,
  };
}

export function totalFieldVolume(state: PriceFieldState) {
  return state.cells.reduce((sum, cell) => sum + cell.volume, 0);
}

export function maxFieldPrice(state: PriceFieldState) {
  return state.cells.reduce((max, cell) => Math.max(max, cell.price), 0);
}
