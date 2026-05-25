export type TileBlock = {
  x: number;
  y: number;
  color: string;
};

export type TileRegion = {
  x: number;
  y: number;
  color: string;
  rows: string[];
};

export const TILE_STUDY_COLUMNS = 64;
export const TILE_STUDY_ROWS = 36;
export const OCEAN = "#001836";
export const OCEAN_DARK = "#001024";

export const REFERENCE_COLORS = {
  canadaForest: "#182e14",
  usGold: "#514514",
  brazilRust: "#502815",
  argentinaTeal: "#07333c",
  africaGreen: "#172d14",
  northAfricaSand: "#514620",
  russiaOchre: "#5d4e2d",
  chinaGreen: "#1d3320",
  euPurple: "#352c4b",
  indiaGold: "#663c0a",
  southeastAsiaMagenta: "#40243b",
  australiaOchre: "#785b26",
  antarcticaSnow: "#546c8e",
  koreaBlue: "#4e5a67",
} as const;

export const TILE_REGIONS: TileRegion[] = [
  {
    x: 4,
    y: 4,
    color: REFERENCE_COLORS.canadaForest,
    rows: [
      "001111111000",
      "011111111100",
      "111111111110",
      "111111111110",
      "111111111100",
      "011111111000",
      "001111100000",
    ],
  },
  {
    x: 7,
    y: 10,
    color: REFERENCE_COLORS.usGold,
    rows: ["1111111110", "1111111111", "0111111110", "0011111000"],
  },
  {
    x: 12,
    y: 14,
    color: REFERENCE_COLORS.brazilRust,
    rows: ["00111100", "01111110", "11111111", "11111110", "01111100", "00111000"],
  },
  {
    x: 13,
    y: 20,
    color: REFERENCE_COLORS.argentinaTeal,
    rows: ["01110", "11110", "11100", "11100", "11000", "11000"],
  },
  {
    x: 29,
    y: 8,
    color: REFERENCE_COLORS.euPurple,
    rows: ["0011110", "0111111", "1111111", "1111110", "0111000"],
  },
  {
    x: 29,
    y: 14,
    color: REFERENCE_COLORS.northAfricaSand,
    rows: ["0111111110", "1111111111", "1111111111", "0111111100"],
  },
  {
    x: 33,
    y: 18,
    color: REFERENCE_COLORS.africaGreen,
    rows: ["0111110", "1111111", "1111111", "1111110", "0111100", "0011000"],
  },
  {
    x: 38,
    y: 4,
    color: REFERENCE_COLORS.russiaOchre,
    rows: [
      "000111111111111100",
      "001111111111111110",
      "011111111111111111",
      "111111111111111111",
      "111111111111111100",
      "011111111111100000",
    ],
  },
  {
    x: 43,
    y: 11,
    color: REFERENCE_COLORS.chinaGreen,
    rows: ["0111111110", "1111111111", "1111111110", "0111111100", "0011110000"],
  },
  {
    x: 41,
    y: 15,
    color: REFERENCE_COLORS.indiaGold,
    rows: ["01110", "11111", "11110", "01100"],
  },
  {
    x: 47,
    y: 16,
    color: REFERENCE_COLORS.southeastAsiaMagenta,
    rows: ["011100", "111110", "011111", "001111", "000110"],
  },
  {
    x: 52,
    y: 12,
    color: REFERENCE_COLORS.koreaBlue,
    rows: ["110", "111", "110"],
  },
  {
    x: 53,
    y: 22,
    color: REFERENCE_COLORS.australiaOchre,
    rows: ["0011110", "0111111", "1111111", "1111110", "0011000"],
  },
  {
    x: 17,
    y: 29,
    color: REFERENCE_COLORS.antarcticaSnow,
    rows: [
      "000111111111111111111111111000",
      "011111111111111111111111111110",
      "111111111111111111111111111111",
      "001111111111111111111111111000",
    ],
  },
];

export function regionBlocks() {
  const blocks: TileBlock[] = [];
  for (const region of TILE_REGIONS) {
    region.rows.forEach((row, rowIndex) => {
      [...row].forEach((cell, columnIndex) => {
        if (cell === "1") {
          blocks.push({
            x: region.x + columnIndex,
            y: region.y + rowIndex,
            color: region.color,
          });
        }
      });
    });
  }
  return blocks;
}

export function hash(x: number, y: number) {
  return Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
}

export function hexToRgb(hex: string) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

export function shade(hex: string, amount: number) {
  const { r, g, b } = hexToRgb(hex);
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `rgb(${clamp(r + amount)}, ${clamp(g + amount)}, ${clamp(b + amount)})`;
}
