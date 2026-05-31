import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createPriceLogisticsDebugSession, type CellCoord } from "../src/economic-sim/price-field-logistics/debugSession";
import {
  executeEvalBlock,
  executeReplCommand,
  renderReplResult,
  shouldStartMultilineEval,
  type ReplRuntime,
} from "../src/economic-sim/price-field-logistics/debugRepl";

function parseCell(value: string | undefined): CellCoord | null {
  if (!value) return null;
  const [x, y] = value.split(",").map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`invalid --cell value: ${value}`);
  return { x, y };
}

function parseArgs(args: string[]) {
  const options: { width?: number; height?: number; cell?: CellCoord | null; json?: boolean } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cell") options.cell = parseCell(args[++index]);
    else if (arg === "--width") options.width = Number(args[++index]);
    else if (arg === "--height") options.height = Number(args[++index]);
    else if (arg === "--json") options.json = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const session = createPriceLogisticsDebugSession(options);
  const runtime: ReplRuntime = { session, json: !!options.json, watch: true };
  const rl = readline.createInterface({ input, output, prompt: "price-logistics> " });
  let evalLines: string[] | null = null;
  let pending = Promise.resolve();

  console.log("price-field logistics debug REPL");
  console.log("warning: eval runs arbitrary local JavaScript against mutable simulation state");
  console.log("type help for commands");
  if (options.cell) console.log(`selected ${options.cell.x},${options.cell.y}`);
  rl.prompt();

  const handleLine = async (line: string) => {
    try {
      if (evalLines) {
        if (line.trim() === ".end") {
          const result = await executeEvalBlock(runtime, evalLines.join("\n"));
          const rendered = renderReplResult(runtime, result);
          if (rendered) console.log(rendered);
          evalLines = null;
          rl.setPrompt("price-logistics> ");
        } else {
          evalLines.push(line);
        }
        rl.prompt();
        return;
      }

      if (shouldStartMultilineEval(line)) {
        evalLines = [];
        console.log("enter JavaScript, finish with .end");
        rl.setPrompt("eval> ");
        rl.prompt();
        return;
      }

      const result = await executeReplCommand(runtime, line);
      const rendered = renderReplResult(runtime, result);
      if (rendered) console.log(rendered);
      if (result.exit) {
        rl.close();
        return;
      }
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
    rl.prompt();
  };

  rl.on("line", (line) => {
    rl.pause();
    pending = pending
      .then(() => handleLine(line))
      .finally(() => {
        if (!rl.closed) rl.resume();
      });
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
