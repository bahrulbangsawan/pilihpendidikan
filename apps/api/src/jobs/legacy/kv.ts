// The KV backend of the legacy facade (`JOBS_LEGACY_BACKEND = kv`, phases
// P0/P1 of 06 §12.5): the pre-migration behaviour of `/api/jobs` and the MCP
// `jobs_*` tools, unchanged except for
//
//   - D-26: no admin bypass (the `owner:job:{id}` stamp must equal the
//     caller's email for everyone; an unstamped job is reachable by nobody);
//   - full KV list pagination (no 1,000-key cap, T6-14).
//
// `metadata.owner` stays a display hint: the caller's email for REST writes,
// "" for MCP writes, as before.

import type { JobData } from "../../types";
import { getJob, putJob } from "../../helpers";
import type { JobMetadata } from "../../helpers";
import { jobIdsOwnedBy, listAllKeys, ownsJob } from "../../ownership";
import { normalizeJobBody } from "./mapping";
import type {
  LegacyContext,
  LegacyJobs,
  LegacyListItem,
  LegacyPatch,
  SectionEdit,
} from "./types";
import { LegacyError } from "./types";

const FOLLOW_UP_UNAVAILABLE =
  "follow_up_at is not available yet: these jobs are still on the legacy store.";

function idOfKey(name: string): string {
  return name.slice("job:".length);
}

async function readJob(kv: KVNamespace, id: string): Promise<JobData | null> {
  try {
    return await getJob(kv, id);
  } catch {
    // An unparseable blob reads as missing (the migration reports it).
    return null;
  }
}

function applyPatch(job: JobData, patch: LegacyPatch): void {
  if (patch.title !== undefined) {
    job.title = patch.title;
  }
  if (patch.status !== undefined) {
    job.status = patch.status;
  }
  if (patch.company !== undefined) {
    job.company = patch.company;
  }
  if (patch.companyUrl !== undefined) {
    job.companyUrl = patch.companyUrl;
  }
  if (patch.salaryRange !== undefined) {
    job.salaryRange = patch.salaryRange;
  }
  if (patch.jobDescription !== undefined) {
    job.jobDescription = patch.jobDescription;
  }
  if (patch.requirements !== undefined) {
    job.requirements = patch.requirements;
  }
  if (patch.interviewDate !== undefined) {
    job.interviewDate = patch.interviewDate;
  }
  if (patch.sections !== undefined) {
    job.sections = patch.sections;
  }
}

export function createKvBackend(ctx: LegacyContext): LegacyJobs {
  const { env, caller } = ctx;
  const kv = env.JOBS_KV;
  // REST writes record the owner in the list metadata; MCP writes leave "".
  const ownerHint = ctx.surface === "rest" ? caller.email : "";

  async function owned(id: string): Promise<JobData | null> {
    const job = await readJob(kv, id);
    return job && (await ownsJob(caller, env, id)) ? job : null;
  }

  return {
    kind: "kv",

    async list(): Promise<LegacyListItem[]> {
      const keys = await listAllKeys<Partial<JobMetadata>>(
        kv,
        "job:",
        Number.POSITIVE_INFINITY
      );
      // Owner-scope from the authoritative stamp (D-26: admins too), never
      // the `metadata.owner` hint, which is "" for MCP writes.
      const owned = await jobIdsOwnedBy(
        env,
        caller.email,
        keys.map((key) => idOfKey(key.name))
      );
      return keys
        .filter((key) => owned.has(idOfKey(key.name)))
        .map((key) => ({
          id: idOfKey(key.name),
          title: key.metadata?.title ?? "",
          status: key.metadata?.status ?? "",
          company: key.metadata?.company ?? "",
          interviewDate: key.metadata?.interviewDate ?? "",
          updatedAt: key.metadata?.updatedAt ?? "",
        }));
    },

    get: owned,

    async owns(id) {
      return (await owned(id)) !== null;
    },

    async create(job) {
      if (await readJob(kv, job.id)) {
        return "exists";
      }
      await putJob(kv, job.id, job, ownerHint);
      await kv.put(`owner:job:${job.id}`, caller.email);
      return job;
    },

    async save(id, body) {
      const existing = await owned(id);
      if (!existing) {
        return null;
      }
      const next = normalizeJobBody(body, id, existing.createdAt);
      // Keep the real owner in the metadata hint.
      const owner = (await kv.get(`owner:job:${id}`)) ?? caller.email;
      await putJob(kv, id, next, owner);
      return next;
    },

    async update(id, patch) {
      const job = await owned(id);
      if (!job) {
        return null;
      }
      if (patch.followUpAt !== undefined) {
        throw new LegacyError(422, FOLLOW_UP_UNAVAILABLE);
      }
      applyPatch(job, patch);
      await putJob(kv, id, job, ownerHint);
      return job;
    },

    async remove(id) {
      if (!(await owned(id))) {
        return false;
      }
      await kv.delete(`job:${id}`);
      await kv.delete(`owner:job:${id}`);
      return true;
    },

    async editSections<T>(
      id: string,
      edit: (sections: JobData["sections"]) => SectionEdit<T>
    ): Promise<T | null> {
      const job = await owned(id);
      if (!job) {
        return null;
      }
      const outcome = edit(structuredClone(job.sections));
      if (outcome.sections) {
        job.sections = outcome.sections;
        await putJob(kv, id, job, ownerHint);
      }
      return outcome.result;
    },
  };
}
