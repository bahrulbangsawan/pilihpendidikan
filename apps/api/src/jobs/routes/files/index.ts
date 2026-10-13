// 05 §7 files on R2 (D-05, 14 §5): upload, metadata, content, delete.
// Ownership is checked on every call (`files.user_id`, not owned = 404); the
// R2 key is built on the server and never leaves it (FileView has no key).

import type { RouteContext } from "../../core/context";
import { notFound } from "../../core/http";
import type { RouteDef } from "../../core/router";
import { defineRoute, fromContract } from "../../core/router";
import {
  fileReferenced,
  loadFile,
  markFileDeletedStatements,
  toFileView,
} from "../../repo/files";
import { renderTicketAuth } from "../../services/cv";
import { serveFileContent } from "../../services/files/download";
import { handleFileUpload } from "./upload";

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("POST /api/v1/files"),
    rateLimit: "file-upload",
    // A render ticket (C8) may upload its variant's cv_pdf once.
    altAuth: renderTicketAuth("upload"),
    handler: (c) => handleFileUpload(c as RouteContext),
  }),
  defineRoute({
    ...fromContract("GET /api/v1/files/{fil_id}"),
    async handler(c) {
      const file = await loadFile(c.db, c.scope, c.params.fil_id);
      if (!file) {
        throw notFound("File not found.");
      }
      return c.respond({ file: toFileView(file) });
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/files/{fil_id}/content"),
    async handler(c) {
      const file = await loadFile(c.db, c.scope, c.params.fil_id);
      if (!file || file.status !== "ready") {
        throw notFound("File not found.");
      }
      const response = await serveFileContent(c.env, c.request, file);
      if (!response) {
        throw notFound("File not found.");
      }
      return response;
    },
  }),
  defineRoute({
    ...fromContract("DELETE /api/v1/files/{fil_id}"),
    async handler(c) {
      const file = await loadFile(c.db, c.scope, c.params.fil_id);
      if (!file) {
        throw notFound("File not found.");
      }
      const deleted = toFileView({
        ...file,
        status: "deleted",
        retention_until: null,
      });
      if (file.status === "deleted") {
        return c.respond({ file: deleted });
      }
      // Marks deleted; the R2 object goes only when nothing references the
      // file (a referenced one is purged by the retention cron later).
      const referenced = await fileReferenced(c.db, c.scope, file.id);
      const response = await c.commit(
        markFileDeletedStatements(c.db, c.scope, file.id, c.now),
        { body: { file: deleted } }
      );
      if (!referenced) {
        await c.env.JOBS_FILES.delete(file.r2_key);
      }
      return response;
    },
  }),
];
