#!/usr/bin/env node
/**
 * @file MCP server que expone `ask_questions`: un formulario interactivo de opcion
 *       multiple dentro de Cursor, via MCP elicitation.
 * @description Existe porque la tool nativa `AskQuestion` NO esta en el catalogo de
 *       todos los runtimes de Cursor (Auto, Grok, Cloud). Cuando falta, este server
 *       da el mismo formulario nativo sin recurrir a un canvas ni a listas A/B/C en
 *       prosa. La llamada BLOQUEA hasta que el usuario envia, declina o cancela.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OptionSchema = z.object({
  id: z.string().min(1).describe("Stable option id, e.g. A, B, merge"),
  label: z.string().min(1).describe("Human-readable label shown to the user"),
});

const QuestionSchema = z.object({
  id: z.string().min(1).describe("Stable question id"),
  prompt: z.string().min(1).describe("Question text"),
  options: z
    .array(OptionSchema)
    .min(2)
    .max(6)
    .describe("2-6 mutually exclusive choices"),
  recommendedId: z
    .string()
    .optional()
    .describe("Option id to preselect / mark as recommended"),
});

const AskInputSchema = {
  title: z.string().optional().describe("Short title for the form header"),
  questions: z
    .array(QuestionSchema)
    .min(1)
    .max(4)
    .describe("1-4 questions (same budget as AskQuestion)"),
};

type AskInput = z.infer<z.ZodObject<typeof AskInputSchema>>;

type FormProperty = {
  type: "string";
  title: string;
  description: string;
  enum?: string[];
  default?: string;
};

function buildFormSchema(input: AskInput) {
  const properties: Record<string, FormProperty> = {};
  const required: string[] = [];

  for (const q of input.questions) {
    const enumValues = q.options.map((o) => o.id);
    const lines = q.options.map((o) => {
      const mark =
        q.recommendedId && o.id === q.recommendedId ? " (Recomendado)" : "";
      return `${o.id}: ${o.label}${mark}`;
    });
    const field: FormProperty = {
      type: "string",
      title: q.prompt.slice(0, 120),
      description: lines.join(" \u00b7 "),
      enum: enumValues,
    };
    if (q.recommendedId && enumValues.includes(q.recommendedId)) {
      field.default = q.recommendedId;
    }
    properties[q.id] = field;
    required.push(q.id);
  }

  // Sin `enum`: es texto libre, el equivalente al "Other" del picker nativo.
  properties.notes = {
    type: "string",
    title: "Notas / Other",
    description: "Opcional. Texto libre si ninguna opcion basta.",
  };

  return { type: "object" as const, properties, required };
}

function formatAnswers(
  input: AskInput,
  content: Record<string, unknown>,
): string {
  const lines: string[] = [
    input.title
      ? `Respuestas - ${input.title}`
      : "Respuestas (cursor-ask / elicitation)",
    "",
  ];

  for (const q of input.questions) {
    const raw = content[q.id];
    const chosen = typeof raw === "string" ? raw : String(raw ?? "");
    const opt = q.options.find((o) => o.id === chosen);
    lines.push(
      `${q.id}=${chosen}${opt ? ` (${opt.label})` : ""} - ${q.prompt}`,
    );
  }

  const notes = content.notes;
  if (typeof notes === "string" && notes.trim()) {
    lines.push("", `notas: ${notes.trim()}`);
  }

  lines.push(
    "",
    "Continua con estas decisiones. No vuelvas a preguntar lo ya respondido.",
  );
  return lines.join("\n");
}

const server = new McpServer({ name: "cursor-ask", version: "1.0.0" });

server.registerTool(
  "ask_questions",
  {
    title: "Ask questions",
    description:
      "Show an interactive multi-choice form in Cursor (MCP elicitation). " +
      "Use this when the native AskQuestion tool is NOT in the agent catalog " +
      "(Auto/Grok/Cloud). Prefer AskQuestion when it is available. " +
      "Blocks until the user submits, declines, or cancels.",
    inputSchema: AskInputSchema,
  },
  async (args) => {
    const input = args as AskInput;

    if (input.questions.length === 0) {
      return {
        content: [{ type: "text" as const, text: "Error: questions[] vacio." }],
        isError: true,
      };
    }

    const message =
      input.title?.trim() ||
      (input.questions.length === 1
        ? input.questions[0].prompt
        : `${input.questions.length} decisiones pendientes`);

    try {
      const result = await server.server.elicitInput(
        {
          mode: "form",
          message,
          requestedSchema: buildFormSchema(input),
        },
        { timeout: 10 * 60_000 },
      );

      if (result.action !== "accept" || !result.content) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Usuario: ${result.action}. No hay respuestas. Pregunta en prosa corta o reintenta ask_questions.`,
            },
          ],
        };
      }

      return {
        content: [
          { type: "text" as const, text: formatAnswers(input, result.content) },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text:
              `cursor-ask fallo (${msg}). ` +
              "Si el cliente no soporta elicitation, pregunta en prosa corta en el chat. " +
              "No uses canvas ni listas A/B/C largas.",
          },
        ],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
