import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/**
 * Ferramenta "run_command": executa um comando no PC do usuário.
 *
 * REGRA: nada roda sem aprovação explícita digitada no terminal do PC.
 * - O comando e a pasta são mostrados na tela antes.
 * - Só "s" aprova. Qualquer outra resposta, ou tempo esgotado, nega.
 * - Não existe opção para aprovar automaticamente.
 *
 * Cada pedido (aprovado ou negado) é registrado em command-log.txt.
 */

export const RUN_COMMAND_TOOL = {
  name: "run_command",
  description:
    "Executa um comando no computador do usuário. O usuário precisa aprovar cada comando no PC antes de ele rodar. Retorna código de saída, stdout e stderr.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Comando a executar. cmd.exe no Windows, sh no Linux e macOS.",
      },
      cwd: {
        type: "string",
        description: "Pasta de trabalho. Se omitido, usa a pasta pessoal do usuário.",
      },
    },
    required: ["command"],
  },
};

const MAX_COMMAND_LENGTH = 2000;
const APPROVAL_TIMEOUT_MS = 45_000;
const EXECUTION_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 100_000;
const LOG_FILE = join(process.cwd(), "command-log.txt");

type RunResult = { ok: boolean; result?: unknown; error?: string };

async function log(line: string) {
  try {
    await appendFile(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch (err) {
    console.error("Falha ao gravar command-log.txt:", err);
  }
}

async function askApproval(command: string, cwd: string): Promise<boolean> {
  console.log("");
  console.log("==================================================");
  console.log("PEDIDO DE COMANDO RECEBIDO DA IA");
  console.log(`Pasta: ${cwd}`);
  console.log("Comando:");
  console.log(`  ${command}`);
  console.log("==================================================");

  const rl = createInterface({ input, output });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), APPROVAL_TIMEOUT_MS);

  try {
    const answer = await rl.question(
      `Permitir executar? (digite s para sim; qualquer outra tecla nega) [${APPROVAL_TIMEOUT_MS / 1000}s]: `,
      { signal: abort.signal }
    );
    return answer.trim().toLowerCase() === "s";
  } catch {
    console.log("Tempo esgotado ou entrada fechada: comando negado.");
    return false;
  } finally {
    clearTimeout(timer);
    rl.close();
  }
}

function execute(command: string, cwd: string) {
  const [bin, argv] =
    process.platform === "win32"
      ? ["cmd.exe", ["/d", "/s", "/c", command]]
      : ["/bin/sh", ["-c", command]];

  return new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
    timedOut: boolean;
  }>((resolve) => {
    const child = spawn(bin, argv, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    const collect = (current: string, chunk: Buffer) => {
      if (current.length >= MAX_OUTPUT_CHARS) {
        truncated = true;
        return current;
      }
      return current + chunk.toString();
    };

    child.stdout.on("data", (chunk: Buffer) => (stdout = collect(stdout, chunk)));
    child.stderr.on("data", (chunk: Buffer) => (stderr = collect(stderr, chunk)));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, EXECUTION_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${err.message}`, truncated, timedOut });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, truncated, timedOut });
    });
  });
}

/** Valida, pede aprovação no PC e só então executa. */
export async function runWithApproval(args: { command?: unknown; cwd?: unknown }): Promise<RunResult> {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) return { ok: false, error: "campo 'command' obrigatório" };
  if (command.length > MAX_COMMAND_LENGTH) {
    return { ok: false, error: `comando muito longo (máximo ${MAX_COMMAND_LENGTH} caracteres)` };
  }

  const cwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : homedir();

  const approved = await askApproval(command, cwd);
  if (!approved) {
    await log(`NEGADO cwd=${cwd} command=${JSON.stringify(command)}`);
    return { ok: false, error: "negado pelo usuário no computador" };
  }

  console.log("Aprovado. Executando...");
  const run = await execute(command, cwd);
  await log(
    `APROVADO cwd=${cwd} command=${JSON.stringify(command)} exit=${run.exitCode} timedOut=${run.timedOut}`
  );

  const text = [
    `exit: ${run.exitCode ?? "(não iniciou)"}${run.timedOut ? " (tempo esgotado)" : ""}`,
    "--- stdout ---",
    run.stdout || "(vazio)",
    "--- stderr ---",
    run.stderr || "(vazio)",
    run.truncated ? "\n[saída truncada]" : "",
  ].join("\n");

  return {
    ok: true,
    result: {
      content: [{ type: "text", text }],
      isError: run.exitCode !== 0,
    },
  };
}
