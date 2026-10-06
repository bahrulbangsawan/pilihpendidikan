import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import {
  getCV,
  normalizeLinkedIn,
  putCV,
  saved,
  stripBulletMarkers,
  text,
} from "../helpers";

const CV_SECTIONS = z.enum([
  "experience",
  "education",
  "skills",
  "awards",
  "certificates",
  "languages",
  "projects",
  "volunteer",
]);

// `cv_update_entry` does a partial merge of caller-supplied `fields` into a
// stored CV entry. The merge is owner-scoped (ownership guard), but the input
// must still be bounded so a caller can't push an unbounded blob or arbitrary
// nested structure into KV. Values are restricted to primitives + flat arrays of
// primitives (CV entry fields are flat strings + string[] like `highlights`);
// total key count and serialized size are capped. See findings/MCP_AUDIT.md F2.
const MAX_ENTRY_FIELD_KEYS = 40;
const MAX_ENTRY_FIELD_VALUE_LEN = 5000;
const MAX_ENTRY_FIELD_ARRAY_LEN = 100;
const MAX_ENTRY_FIELDS_BYTES = 20_000;

const cvEntryFieldValue = z.union([
  z.string().max(MAX_ENTRY_FIELD_VALUE_LEN),
  z.number(),
  z.boolean(),
  z.null(),
  z
    .array(
      z.union([
        z.string().max(MAX_ENTRY_FIELD_VALUE_LEN),
        z.number(),
        z.boolean(),
      ])
    )
    .max(MAX_ENTRY_FIELD_ARRAY_LEN),
]);

const cvEntryFields = z
  .record(z.string(), cvEntryFieldValue)
  .refine((obj) => Object.keys(obj).length <= MAX_ENTRY_FIELD_KEYS, {
    message: `Too many fields (max ${MAX_ENTRY_FIELD_KEYS}).`,
  })
  .refine((obj) => JSON.stringify(obj).length <= MAX_ENTRY_FIELDS_BYTES, {
    message: `fields payload too large (max ${MAX_ENTRY_FIELDS_BYTES} bytes).`,
  })
  .describe("Object with fields to update (partial update)");

export function registerCvRemoveTools(server: McpServer, env: Env): void {
  server.registerTool(
    "cv_remove_entry",
    {
      description:
        "Remove an entry from a list section by its index (0-based).",
      inputSchema: {
        cv_id: z.string().default("default"),
        section: CV_SECTIONS,
        index: z
          .number()
          .int()
          .min(0)
          .describe("0-based index of the entry to remove"),
      },
    },
    async ({ cv_id, section, index }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const arr = cv[section] as unknown[];
      if (index >= arr.length) {
        return text(
          `Index ${index} out of range. Section "${section}" has ${arr.length} entries.`
        );
      }
      arr.splice(index, 1);
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Removed entry at index ${index} from "${section}".`, cv_id);
    }
  );

  server.registerTool(
    "cv_remove_entry_by_id",
    {
      description:
        "Remove an entry from a list section by its ID. Safer than index-based removal since IDs don't shift.",
      inputSchema: {
        cv_id: z.string().default("default"),
        section: CV_SECTIONS,
        id: z
          .string()
          .describe("The entry's id field (visible in cv_get output)"),
      },
    },
    async ({ cv_id, section, id }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const arr = cv[section] as unknown as { id: string }[];
      const idx = arr.findIndex((e) => e.id === id);
      if (idx === -1) {
        return text(`No entry with id "${id}" found in "${section}".`);
      }
      arr.splice(idx, 1);
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Removed entry "${id}" from "${section}".`, cv_id);
    }
  );

  server.registerTool(
    "cv_update_entry",
    {
      description:
        "Update an existing entry in a list section by index. Only provided fields are updated.",
      inputSchema: {
        cv_id: z.string().default("default"),
        section: CV_SECTIONS,
        index: z
          .number()
          .int()
          .min(0)
          .describe("0-based index of the entry to update"),
        fields: cvEntryFields,
      },
    },
    async ({ cv_id, section, index, fields }) => {
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const arr = cv[section] as unknown as Record<string, unknown>[];
      if (index >= arr.length) {
        return text(
          `Index ${index} out of range. Section "${section}" has ${arr.length} entries.`
        );
      }
      if (typeof fields.description === "string") {
        fields.description = stripBulletMarkers(fields.description);
      }
      if (typeof fields.linked_in === "string") {
        fields.linked_in = normalizeLinkedIn(fields.linked_in);
      }
      Object.assign(arr[index], fields);
      await putCV(env.CV_KV, cv_id, cv);
      return saved(`Updated entry at index ${index} in "${section}".`, cv_id);
    }
  );
}
