// The demo data `scripts/seed-demo.ts` writes through `/api/v1`: one
// applicant (a Jakarta-based backend engineer), 24 tracked applications
// spread over every board stage, 15 discovered postings for the inbox, the
// sources they came from, automation rules, profile facts and saved answers.
// Companies, roles and pay are illustrative mock data for local development.

import type {
  ApplicationMode,
  EmploymentType,
  InterviewKind,
  InterviewOutcome,
  SalaryPeriod,
  Stage,
  SubmissionMethod,
  WorkplaceType,
} from "@pilihpendidikan/jobs-contracts/enums";

export const DEMO_DEVICE_NAME = "Demo laptop (seed)";
export const DEMO_PERSONA = {
  first: "Nadia",
  last: "Rahmawati",
  phone: "+62 812 7788 4521",
  location: "Jakarta, Indonesia",
  linkedin: "https://www.linkedin.com/in/nadia-rahmawati-demo",
  github: "https://github.com/nadia-rahmawati-demo",
} as const;

export interface DemoLocation {
  city?: string;
  country_code?: string;
  raw: string;
}

export interface DemoSalary {
  currency: "IDR" | "USD" | "SGD";
  max: number;
  min: number;
  period: SalaryPeriod;
}

export interface DemoJob {
  applyUrl: string;
  blurb: string;
  company: string;
  department: string;
  domain: string;
  employment: EmploymentType;
  location: DemoLocation;
  /** Days before now the posting went up. */
  postedDaysAgo: number;
  requirements: string[];
  salary: DemoSalary | null;
  seniority: string;
  title: string;
  workplace: WorkplaceType;
}

export interface DemoInterview {
  /** Negative = past. */
  days: number;
  durationMin: number;
  hour: number;
  interviewers: string[];
  kind: InterviewKind;
  location: string;
  notes?: string;
  outcome: InterviewOutcome;
}

export interface DemoOffer {
  /** Accept it (moves the card to `accepted`). */
  accept?: boolean;
  base: number;
  bonus?: string;
  currency: "IDR" | "USD" | "SGD";
  deadlineInDays: number;
  equity?: string;
  notes: string;
  period: SalaryPeriod;
  receivedDaysAgo: number;
}

export interface DemoApplication {
  /** Mark applied this many days ago (applied and later stages). */
  appliedDaysAgo?: number;
  appliedMethod?: SubmissionMethod;
  /** Days from now (negative = overdue). */
  followUpInDays?: number;
  interviews?: DemoInterview[];
  job: DemoJob;
  mode?: ApplicationMode;
  notes?: Array<{ daysAgo: number; text: string }>;
  offer?: DemoOffer;
  priority?: -1 | 0 | 1;
  /** The board column the card ends in. */
  stage: Stage;
  /** Automation demo for `ready` cards (needs the demo device). */
  task?: "submit_approval" | "answer_approval" | "queued" | "cancelled";
}

const JAKARTA: DemoLocation = {
  raw: "Jakarta, Indonesia",
  city: "Jakarta",
  country_code: "ID",
};
const BANDUNG: DemoLocation = {
  raw: "Bandung, Indonesia",
  city: "Bandung",
  country_code: "ID",
};
const SURABAYA: DemoLocation = {
  raw: "Surabaya, Indonesia",
  city: "Surabaya",
  country_code: "ID",
};
const SINGAPORE: DemoLocation = {
  raw: "Singapore",
  city: "Singapore",
  country_code: "SG",
};
const REMOTE_APAC: DemoLocation = { raw: "Remote (APAC)" };
const REMOTE_ANY: DemoLocation = { raw: "Remote" };

const MILLION = 1_000_000;

function idr(minJt: number, maxJt: number): DemoSalary {
  return {
    currency: "IDR",
    min: minJt * MILLION,
    max: maxJt * MILLION,
    period: "month",
  };
}

function usd(minK: number, maxK: number): DemoSalary {
  return {
    currency: "USD",
    min: minK * 1000,
    max: maxK * 1000,
    period: "year",
  };
}

function sgd(minK: number, maxK: number): DemoSalary {
  return {
    currency: "SGD",
    min: minK * 1000,
    max: maxK * 1000,
    period: "year",
  };
}

/** The posting text the API stores (`description_text`). */
export function describe(job: DemoJob): string {
  const where =
    job.workplace === "remote"
      ? "This is a remote role."
      : `This is a ${job.workplace} role based in ${job.location.raw}.`;
  return [
    `${job.company} is hiring a ${job.title} for its ${job.department} team. ${job.blurb}`,
    where,
    "What you will do:",
    "- Design, build and run backend services that handle production traffic",
    "- Own features end to end, from the design doc to monitoring in production",
    "- Review code and help teammates grow",
    "What we are looking for:",
    ...job.requirements.map((r) => `- ${r}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tracked applications (24): every board column
// ---------------------------------------------------------------------------

export const DEMO_APPLICATIONS: DemoApplication[] = [
  // saved (3)
  {
    stage: "saved",
    priority: 1,
    job: {
      title: "Senior Backend Engineer (Go)",
      company: "Grab",
      domain: "grab.com",
      department: "GrabPay",
      seniority: "senior",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(45, 60),
      postedDaysAgo: 4,
      applyUrl: "https://grab.careers/jobs/senior-backend-engineer-go-jakarta",
      blurb:
        "You will scale the payment ledger that settles millions of rides and food orders every day across Southeast Asia.",
      requirements: [
        "5+ years building backend services, ideally in Go",
        "Experience with distributed transactions and idempotent APIs",
        "Comfortable with Kafka, MySQL or PostgreSQL",
      ],
    },
    notes: [
      {
        daysAgo: 2,
        text: "Referral possible through Dimas (ex-colleague, GrabPay platform). Ask him this week.",
      },
    ],
  },
  {
    stage: "saved",
    job: {
      title: "Backend Engineer, Verify",
      company: "GitLab",
      domain: "gitlab.com",
      department: "Verify (CI)",
      seniority: "mid",
      location: REMOTE_ANY,
      workplace: "remote",
      employment: "full_time",
      salary: usd(98, 140),
      postedDaysAgo: 9,
      applyUrl: "https://boards.greenhouse.io/gitlab/jobs/7710023002",
      blurb:
        "Help millions of developers run their pipelines faster: you will work on the CI job scheduler and runner fleet.",
      requirements: [
        "Strong Ruby or Go experience",
        "Familiarity with PostgreSQL performance tuning",
        "Async, written-first communication in a remote team",
      ],
    },
  },
  {
    stage: "saved",
    priority: -1,
    job: {
      title: "Software Engineer, Backend",
      company: "Bibit",
      domain: "bibit.id",
      department: "Investment Platform",
      seniority: "mid",
      location: JAKARTA,
      workplace: "onsite",
      employment: "full_time",
      salary: idr(22, 32),
      postedDaysAgo: 12,
      applyUrl: "https://career.bibit.id/jobs/software-engineer-backend",
      blurb:
        "Build the order routing and portfolio services behind one of Indonesia's largest mutual fund apps.",
      requirements: [
        "3+ years with Go or Node.js",
        "Experience with relational databases and caching",
        "Interest in personal finance products",
      ],
    },
  },
  // preparing (2)
  {
    stage: "preparing",
    mode: "approval",
    followUpInDays: 3,
    job: {
      title: "Senior Software Engineer, Payments",
      company: "Xendit",
      domain: "xendit.co",
      department: "Payments Core",
      seniority: "senior",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(40, 55),
      postedDaysAgo: 6,
      applyUrl:
        "https://jobs.lever.co/xendit/5f2d6c1e-9a1b-4d1e-8f3c-2b7a91c0d4e1",
      blurb:
        "Payments Core moves money for thousands of businesses across Indonesia and the Philippines; reliability is the product.",
      requirements: [
        "5+ years of backend engineering, Go or TypeScript",
        "Hands-on experience with payment rails, ledgers or reconciliation",
        "On-call experience for high-availability systems",
      ],
    },
    notes: [
      {
        daysAgo: 1,
        text: "Tailor the CV around the ledger migration at the previous job; drop the frontend project.",
      },
    ],
  },
  {
    stage: "preparing",
    mode: "approval",
    task: "cancelled",
    job: {
      title: "Software Engineer, Backend",
      company: "Canva",
      domain: "canva.com",
      department: "Print Platform",
      seniority: "mid",
      location: REMOTE_APAC,
      workplace: "remote",
      employment: "full_time",
      salary: usd(85, 115),
      postedDaysAgo: 15,
      applyUrl:
        "https://jobs.lever.co/canva/0c8e7b9a-3e4f-4b6d-9a2c-7d1e5f3a8b20",
      blurb:
        "Print Platform turns designs into physical products shipped to 190 countries.",
      requirements: [
        "Java, Kotlin or Go in production",
        "Experience with event-driven architectures",
        "Product sense and care for craft",
      ],
    },
  },
  // ready (3) — the automation demo
  {
    stage: "ready",
    mode: "approval",
    task: "submit_approval",
    priority: 1,
    job: {
      title: "Software Engineer II, Backend",
      company: "Tokopedia",
      domain: "tokopedia.com",
      department: "Fulfillment",
      seniority: "mid",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(30, 42),
      postedDaysAgo: 5,
      applyUrl: "https://boards.greenhouse.io/tokopedia/jobs/6123456",
      blurb:
        "Fulfillment routes every order to the right warehouse and courier, at peak sale traffic of 10x the daily average.",
      requirements: [
        "3+ years with Go",
        "Experience with PostgreSQL, Redis and message queues",
        "Comfortable debugging production incidents",
      ],
    },
  },
  {
    stage: "ready",
    mode: "approval",
    task: "answer_approval",
    job: {
      title: "Backend Engineer, Payments Infrastructure",
      company: "Stripe",
      domain: "stripe.com",
      department: "Payments Infrastructure",
      seniority: "mid",
      location: SINGAPORE,
      workplace: "hybrid",
      employment: "full_time",
      salary: sgd(120, 170),
      postedDaysAgo: 8,
      applyUrl: "https://boards.greenhouse.io/stripe/jobs/5401234",
      blurb:
        "Build the systems that let businesses in Asia-Pacific accept local payment methods with Stripe-level reliability.",
      requirements: [
        "Experience designing APIs used by other engineers",
        "Ruby, Java or Go",
        "Clear written communication",
      ],
    },
  },
  {
    stage: "ready",
    mode: "approval",
    task: "queued",
    job: {
      title: "Senior Backend Engineer",
      company: "Traveloka",
      domain: "traveloka.com",
      department: "Accommodation",
      seniority: "senior",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(38, 50),
      postedDaysAgo: 3,
      applyUrl: "https://boards.greenhouse.io/traveloka/jobs/4987001",
      blurb:
        "Accommodation serves hotel inventory and pricing to millions of travellers; you will own the availability search path.",
      requirements: [
        "5+ years of backend development (Java or Go)",
        "Search or caching at scale",
        "Mentoring experience",
      ],
    },
  },
  // applied (5)
  {
    stage: "applied",
    appliedDaysAgo: 6,
    followUpInDays: 2,
    job: {
      title: "Backend Engineer, Seller Platform",
      company: "Shopee",
      domain: "shopee.com",
      department: "Seller Platform",
      seniority: "mid",
      location: SINGAPORE,
      workplace: "onsite",
      employment: "full_time",
      salary: sgd(84, 110),
      postedDaysAgo: 14,
      applyUrl:
        "https://careers.shopee.sg/job-detail/backend-engineer-seller-platform",
      blurb:
        "Seller Platform gives millions of merchants the tools to list, price and promote products.",
      requirements: [
        "Go or Java",
        "MySQL and sharding experience",
        "Willing to relocate to Singapore",
      ],
    },
    notes: [
      {
        daysAgo: 6,
        text: "Applied through the careers site. Recruiter: Mei Ling (LinkedIn).",
      },
    ],
  },
  {
    stage: "applied",
    appliedDaysAgo: 9,
    followUpInDays: -1,
    job: {
      title: "Senior Software Engineer",
      company: "Mekari",
      domain: "mekari.com",
      department: "Talenta (HR)",
      seniority: "senior",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(35, 48),
      postedDaysAgo: 20,
      applyUrl:
        "https://jobs.lever.co/mekari/a7b1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      blurb:
        "Talenta runs payroll and attendance for thousands of Indonesian companies.",
      requirements: [
        "Ruby on Rails or Go",
        "Experience with multi-tenant SaaS",
        "Understanding of Indonesian payroll rules is a plus",
      ],
    },
    notes: [
      {
        daysAgo: 1,
        text: "No reply after a week. Send a short follow-up to the recruiter.",
      },
    ],
  },
  {
    stage: "applied",
    appliedDaysAgo: 3,
    followUpInDays: 7,
    job: {
      title: "Backend Engineer",
      company: "eFishery",
      domain: "efishery.com",
      department: "Supply Chain",
      seniority: "mid",
      location: BANDUNG,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(20, 30),
      postedDaysAgo: 10,
      applyUrl: "https://efishery.com/careers/backend-engineer-supply-chain",
      blurb:
        "Connect fish and shrimp farmers to feed suppliers and buyers across Indonesia.",
      requirements: [
        "Node.js or Go",
        "PostgreSQL",
        "Happy to visit farms in West Java now and then",
      ],
    },
  },
  {
    stage: "applied",
    appliedDaysAgo: 12,
    job: {
      title: "Software Engineer, Backend",
      company: "Automattic",
      domain: "automattic.com",
      department: "WooCommerce",
      seniority: "mid",
      location: REMOTE_ANY,
      workplace: "remote",
      employment: "full_time",
      salary: usd(80, 120),
      postedDaysAgo: 25,
      applyUrl:
        "https://automattic.com/work-with-us/job/software-engineer-backend",
      blurb:
        "A fully distributed company; you will work on the services behind WooCommerce Payments.",
      requirements: [
        "PHP or Go",
        "Experience with payments or e-commerce",
        "Self-directed, written-first work style",
      ],
    },
  },
  {
    stage: "applied",
    appliedDaysAgo: 2,
    appliedMethod: "email",
    followUpInDays: 5,
    job: {
      title: "Backend Engineer",
      company: "Ajaib",
      domain: "ajaib.co.id",
      department: "Brokerage",
      seniority: "mid",
      location: JAKARTA,
      workplace: "onsite",
      employment: "full_time",
      salary: idr(25, 35),
      postedDaysAgo: 7,
      applyUrl: "https://ajaib.co.id/careers/backend-engineer",
      blurb:
        "Build the trading engine and market data services for Indonesia's retail investors.",
      requirements: [
        "Go or Java",
        "Low-latency systems",
        "Interest in capital markets",
      ],
    },
    notes: [
      {
        daysAgo: 2,
        text: "Sent CV and cover letter to the hiring manager by email.",
      },
    ],
  },
  // interviewing (4)
  {
    stage: "interviewing",
    appliedDaysAgo: 18,
    priority: 1,
    job: {
      title: "Senior Software Engineer, GoPay",
      company: "Gojek",
      domain: "gojek.com",
      department: "GoPay",
      seniority: "senior",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(42, 58),
      postedDaysAgo: 30,
      applyUrl: "https://boards.greenhouse.io/gojek/jobs/5566778",
      blurb:
        "GoPay processes billions of transactions a year; the wallet team owns balances, top-ups and transfers.",
      requirements: [
        "5+ years with Go or Java",
        "Experience with financial systems",
        "Strong system design",
      ],
    },
    interviews: [
      {
        kind: "phone_screen",
        days: -10,
        hour: 10,
        durationMin: 30,
        location: "Google Meet",
        interviewers: ["Ayu (Talent Acquisition)"],
        outcome: "passed",
        notes: "Went well. Asked about the ledger migration and on-call.",
      },
      {
        kind: "technical",
        days: 2,
        hour: 14,
        durationMin: 90,
        location: "Gojek HQ, Pasaraya Blok M, Jakarta",
        interviewers: ["Rizky Pratama", "Hendra Wijaya"],
        outcome: "pending",
        notes: "System design: wallet top-up flow. Review idempotency keys.",
      },
    ],
  },
  {
    stage: "interviewing",
    appliedDaysAgo: 14,
    job: {
      title: "Backend Engineer",
      company: "Kredivo",
      domain: "kredivo.com",
      department: "Credit Risk Platform",
      seniority: "mid",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(28, 40),
      postedDaysAgo: 22,
      applyUrl:
        "https://jobs.lever.co/kredivo/3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
      blurb:
        "Serve credit decisions in milliseconds for millions of buy-now-pay-later users.",
      requirements: ["Python or Go", "Feature stores or ML serving", "SQL"],
    },
    interviews: [
      {
        kind: "take_home",
        days: -5,
        hour: 9,
        durationMin: 240,
        location: "Take-home assignment (GitHub repo)",
        interviewers: [],
        outcome: "passed",
      },
      {
        kind: "onsite",
        days: 5,
        hour: 10,
        durationMin: 180,
        location: "Kredivo office, Menara Mandiri, Jakarta",
        interviewers: ["Engineering panel"],
        outcome: "pending",
      },
    ],
  },
  {
    stage: "interviewing",
    appliedDaysAgo: 7,
    job: {
      title: "Software Engineer",
      company: "Wise",
      domain: "wise.com",
      department: "Asia-Pacific Payouts",
      seniority: "mid",
      location: SINGAPORE,
      workplace: "hybrid",
      employment: "full_time",
      salary: sgd(95, 130),
      postedDaysAgo: 16,
      applyUrl: "https://wise.jobs/job/software-engineer-apac-payouts",
      blurb:
        "Make cross-border payouts to Indonesia, the Philippines and Vietnam instant and cheap.",
      requirements: [
        "Java or Kotlin",
        "Payments experience",
        "Ownership mindset",
      ],
    },
    interviews: [
      {
        kind: "phone_screen",
        days: 1,
        hour: 16,
        durationMin: 45,
        location: "Zoom",
        interviewers: ["Priya (Recruiter)"],
        outcome: "pending",
      },
    ],
  },
  {
    stage: "interviewing",
    appliedDaysAgo: 11,
    job: {
      title: "Software Engineer, Backend",
      company: "Vercel",
      domain: "vercel.com",
      department: "Build Infrastructure",
      seniority: "senior",
      location: REMOTE_ANY,
      workplace: "remote",
      employment: "full_time",
      salary: usd(130, 175),
      postedDaysAgo: 19,
      applyUrl:
        "https://jobs.ashbyhq.com/vercel/8d9e0f1a-2b3c-4d5e-9f6a-7b8c9d0e1f2a",
      blurb:
        "Make builds faster for every deployment on the platform: caching, scheduling and isolation.",
      requirements: ["Go or Rust", "Container runtimes", "Distributed caching"],
    },
    interviews: [
      {
        kind: "technical",
        days: -2,
        hour: 21,
        durationMin: 60,
        location: "Zoom",
        interviewers: ["Sam Lee"],
        outcome: "pending",
        notes: "Live coding: rate limiter. Waiting for feedback.",
      },
      {
        kind: "behavioral",
        days: 6,
        hour: 22,
        durationMin: 45,
        location: "Zoom",
        interviewers: ["Engineering Manager"],
        outcome: "pending",
      },
    ],
  },
  // offer (1)
  {
    stage: "offer",
    appliedDaysAgo: 28,
    priority: 1,
    job: {
      title: "Senior Backend Engineer",
      company: "DANA Indonesia",
      domain: "dana.id",
      department: "Merchant Payments",
      seniority: "senior",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(45, 60),
      postedDaysAgo: 40,
      applyUrl: "https://dana.id/careers/senior-backend-engineer",
      blurb:
        "Merchant Payments powers QRIS acceptance for millions of small businesses.",
      requirements: [
        "Java or Go",
        "High-throughput payment systems",
        "Mentoring",
      ],
    },
    interviews: [
      {
        kind: "phone_screen",
        days: -21,
        hour: 11,
        durationMin: 30,
        location: "Google Meet",
        interviewers: ["Recruiter"],
        outcome: "passed",
      },
      {
        kind: "technical",
        days: -14,
        hour: 13,
        durationMin: 90,
        location: "DANA office, Jakarta",
        interviewers: ["Tech Lead", "Staff Engineer"],
        outcome: "passed",
      },
      {
        kind: "final",
        days: -7,
        hour: 15,
        durationMin: 60,
        location: "DANA office, Jakarta",
        interviewers: ["VP Engineering"],
        outcome: "passed",
      },
    ],
    offer: {
      base: 52 * MILLION,
      currency: "IDR",
      period: "month",
      bonus: "2 months performance bonus",
      equity: "ESOP, 4-year vesting",
      receivedDaysAgo: 2,
      deadlineInDays: 5,
      notes:
        "Negotiate base to 55 jt. Ask about remote days and the ESOP strike price.",
    },
  },
  // accepted (1)
  {
    stage: "accepted",
    appliedDaysAgo: 35,
    job: {
      title: "Senior Software Engineer, Platform",
      company: "Halodoc",
      domain: "halodoc.com",
      department: "Platform",
      seniority: "senior",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(40, 55),
      postedDaysAgo: 50,
      applyUrl: "https://boards.greenhouse.io/halodoc/jobs/4412233",
      blurb:
        "Platform builds the shared services behind teleconsultation, pharmacy delivery and lab tests.",
      requirements: ["Java or Go", "Kubernetes", "Observability"],
    },
    interviews: [
      {
        kind: "technical",
        days: -25,
        hour: 10,
        durationMin: 90,
        location: "Google Meet",
        interviewers: ["Platform team"],
        outcome: "passed",
      },
      {
        kind: "final",
        days: -18,
        hour: 14,
        durationMin: 60,
        location: "Halodoc office, Jakarta",
        interviewers: ["CTO"],
        outcome: "passed",
      },
    ],
    offer: {
      accept: true,
      base: 50 * MILLION,
      currency: "IDR",
      period: "month",
      bonus: "1.5 months",
      receivedDaysAgo: 10,
      deadlineInDays: -3,
      notes:
        "Accepted. Start date in four weeks; notice period at the current job is one month.",
    },
  },
  // rejected (3)
  {
    stage: "rejected",
    appliedDaysAgo: 24,
    job: {
      title: "Senior Backend Engineer",
      company: "Atlassian",
      domain: "atlassian.com",
      department: "Jira Cloud",
      seniority: "senior",
      location: REMOTE_APAC,
      workplace: "remote",
      employment: "full_time",
      salary: usd(110, 150),
      postedDaysAgo: 35,
      applyUrl:
        "https://jobs.lever.co/atlassian/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      blurb: "Scale the issue search and permissions services of Jira Cloud.",
      requirements: [
        "Java or Kotlin",
        "AWS",
        "Large-scale distributed systems",
      ],
    },
    interviews: [
      {
        kind: "technical",
        days: -12,
        hour: 8,
        durationMin: 75,
        location: "Zoom",
        interviewers: ["Two senior engineers"],
        outcome: "failed",
        notes:
          "Struggled with the Java concurrency questions. Practise before the next Java-heavy loop.",
      },
    ],
  },
  {
    stage: "rejected",
    appliedDaysAgo: 20,
    job: {
      title: "Software Engineer",
      company: "Blibli",
      domain: "blibli.com",
      department: "Search",
      seniority: "mid",
      location: JAKARTA,
      workplace: "onsite",
      employment: "full_time",
      salary: idr(20, 30),
      postedDaysAgo: 30,
      applyUrl: "https://careers.blibli.com/job/software-engineer-search",
      blurb: "Improve product search relevance for Blibli's marketplace.",
      requirements: ["Java", "Elasticsearch", "A/B testing"],
    },
    notes: [
      {
        daysAgo: 8,
        text: "Rejection email: they went with a candidate with more Elasticsearch experience.",
      },
    ],
  },
  {
    stage: "rejected",
    appliedDaysAgo: 16,
    job: {
      title: "Backend Engineer",
      company: "Flip",
      domain: "flip.id",
      department: "Transfers",
      seniority: "mid",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(22, 32),
      postedDaysAgo: 26,
      applyUrl: "https://flip.id/careers/backend-engineer",
      blurb: "Make bank transfers between Indonesian banks free and instant.",
      requirements: ["Go or PHP", "Bank integrations", "MySQL"],
    },
    interviews: [
      {
        kind: "phone_screen",
        days: -9,
        hour: 13,
        durationMin: 30,
        location: "Phone",
        interviewers: ["HR"],
        outcome: "failed",
      },
    ],
  },
  // withdrawn (2)
  {
    stage: "withdrawn",
    appliedDaysAgo: 15,
    job: {
      title: "Backend Engineer",
      company: "Amartha",
      domain: "amartha.com",
      department: "Lending",
      seniority: "mid",
      location: JAKARTA,
      workplace: "onsite",
      employment: "full_time",
      salary: idr(20, 28),
      postedDaysAgo: 27,
      applyUrl: "https://amartha.com/careers/backend-engineer",
      blurb: "Microfinance for women-led businesses in rural Indonesia.",
      requirements: ["Go", "PostgreSQL", "Event sourcing is a plus"],
    },
    notes: [
      {
        daysAgo: 4,
        text: "Withdrew: fully onsite five days a week, and the range is below my floor.",
      },
    ],
  },
  {
    stage: "withdrawn",
    appliedDaysAgo: 13,
    job: {
      title: "Backend Engineer",
      company: "Kopi Kenangan",
      domain: "kopikenangan.com",
      department: "Store Technology",
      seniority: "mid",
      location: SURABAYA,
      workplace: "hybrid",
      employment: "contract",
      salary: idr(15, 22),
      postedDaysAgo: 21,
      applyUrl: "https://kopikenangan.com/careers/backend-engineer-surabaya",
      blurb:
        "Point-of-sale and loyalty services for hundreds of coffee stores.",
      requirements: ["Node.js", "MySQL", "Offline-first sync"],
    },
    notes: [
      {
        daysAgo: 3,
        text: "Withdrew: twelve-month contract and relocation to Surabaya.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Sources and discovered postings (inbox)
// ---------------------------------------------------------------------------

export interface DemoSource {
  adapter: "greenhouse" | "lever" | "ashby" | "workable";
  config: Record<string, string>;
  enabled: boolean;
  label: string;
  /** The ATS org the postings carry (`source_org`). */
  org: string;
  schedule: string | null;
}

export const DEMO_SOURCES: DemoSource[] = [
  {
    adapter: "greenhouse",
    label: "Traveloka on Greenhouse",
    config: { board_token: "traveloka" },
    org: "traveloka",
    enabled: true,
    schedule: "daily",
  },
  {
    adapter: "lever",
    label: "Ninja Van on Lever",
    config: { site: "ninjavan" },
    org: "ninjavan",
    enabled: true,
    schedule: "daily",
  },
  {
    adapter: "ashby",
    label: "Deel on Ashby",
    config: { job_board_name: "deel" },
    org: "deel",
    enabled: true,
    schedule: null,
  },
  {
    adapter: "workable",
    label: "Majoo on Workable",
    config: { subdomain: "majoo" },
    org: "majoo",
    enabled: false,
    schedule: null,
  },
];

export interface DemoPosting {
  job: DemoJob;
  /** Index into DEMO_SOURCES. */
  source: 0 | 1 | 2;
  /** What the seed does with it in the inbox. */
  triage?: "track" | "seen" | "dismiss";
}

export const DEMO_POSTINGS: DemoPosting[] = [
  // Traveloka (Greenhouse)
  {
    source: 0,
    triage: "track",
    job: {
      title: "Backend Engineer, Flights",
      company: "Traveloka",
      domain: "traveloka.com",
      department: "Flights",
      seniority: "mid",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(26, 36),
      postedDaysAgo: 2,
      applyUrl: "https://boards.greenhouse.io/traveloka/jobs/",
      blurb: "Own fare search and booking APIs used by millions of travellers.",
      requirements: ["Java or Go", "Caching", "API design"],
    },
  },
  {
    source: 0,
    triage: "track",
    job: {
      title: "Senior Software Engineer, Payments",
      company: "Traveloka",
      domain: "traveloka.com",
      department: "Payments",
      seniority: "senior",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(40, 55),
      postedDaysAgo: 1,
      applyUrl: "https://boards.greenhouse.io/traveloka/jobs/",
      blurb:
        "Payment orchestration across cards, e-wallets and bank transfers.",
      requirements: ["Go", "Payment gateways", "Reconciliation"],
    },
  },
  {
    source: 0,
    triage: "seen",
    job: {
      title: "Data Engineer",
      company: "Traveloka",
      domain: "traveloka.com",
      department: "Data Platform",
      seniority: "mid",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(25, 35),
      postedDaysAgo: 5,
      applyUrl: "https://boards.greenhouse.io/traveloka/jobs/",
      blurb: "Batch and streaming pipelines for pricing and personalisation.",
      requirements: ["Python", "Spark or Flink", "BigQuery"],
    },
  },
  {
    source: 0,
    job: {
      title: "Site Reliability Engineer",
      company: "Traveloka",
      domain: "traveloka.com",
      department: "Infrastructure",
      seniority: "mid",
      location: BANDUNG,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(24, 34),
      postedDaysAgo: 3,
      applyUrl: "https://boards.greenhouse.io/traveloka/jobs/",
      blurb:
        "Keep the platform up through the biggest travel sales of the year.",
      requirements: ["Kubernetes", "Terraform", "Go or Python"],
    },
  },
  {
    source: 0,
    triage: "dismiss",
    job: {
      title: "Frontend Engineer (React)",
      company: "Traveloka",
      domain: "traveloka.com",
      department: "Experiences",
      seniority: "junior",
      location: JAKARTA,
      workplace: "onsite",
      employment: "full_time",
      salary: idr(14, 20),
      postedDaysAgo: 6,
      applyUrl: "https://boards.greenhouse.io/traveloka/jobs/",
      blurb: "Build the booking flow for attractions and activities.",
      requirements: ["React", "TypeScript", "Accessibility"],
    },
  },
  // Ninja Van (Lever)
  {
    source: 1,
    job: {
      title: "Senior Backend Engineer, Routing",
      company: "Ninja Van",
      domain: "ninjavan.co",
      department: "Routing",
      seniority: "senior",
      location: SINGAPORE,
      workplace: "hybrid",
      employment: "full_time",
      salary: sgd(110, 150),
      postedDaysAgo: 1,
      applyUrl: "https://jobs.lever.co/ninjavan/",
      blurb:
        "Route optimisation for a million parcels a day across six countries.",
      requirements: ["Go or Java", "Graph algorithms", "PostgreSQL"],
    },
  },
  {
    source: 1,
    triage: "seen",
    job: {
      title: "Backend Engineer",
      company: "Ninja Van",
      domain: "ninjavan.co",
      department: "Last Mile",
      seniority: "mid",
      location: JAKARTA,
      workplace: "hybrid",
      employment: "full_time",
      salary: idr(22, 32),
      postedDaysAgo: 4,
      applyUrl: "https://jobs.lever.co/ninjavan/",
      blurb: "Driver apps and proof-of-delivery services for Indonesia.",
      requirements: ["Go", "Mobile APIs", "Kafka"],
    },
  },
  {
    source: 1,
    job: {
      title: "Software Engineer, Warehouse Systems",
      company: "Ninja Van",
      domain: "ninjavan.co",
      department: "Warehouse",
      seniority: "mid",
      location: SURABAYA,
      workplace: "onsite",
      employment: "full_time",
      salary: idr(18, 26),
      postedDaysAgo: 2,
      applyUrl: "https://jobs.lever.co/ninjavan/",
      blurb: "Sorting-hub software for the East Java hub.",
      requirements: ["Java or Go", "Embedded scanners integration", "SQL"],
    },
  },
  {
    source: 1,
    job: {
      title: "Engineering Manager, Platform",
      company: "Ninja Van",
      domain: "ninjavan.co",
      department: "Platform",
      seniority: "lead",
      location: SINGAPORE,
      workplace: "hybrid",
      employment: "full_time",
      salary: sgd(160, 210),
      postedDaysAgo: 7,
      applyUrl: "https://jobs.lever.co/ninjavan/",
      blurb:
        "Lead two platform teams owning CI/CD, observability and data stores.",
      requirements: ["People management", "Platform engineering", "Hiring"],
    },
  },
  {
    source: 1,
    job: {
      title: "Backend Engineer (Contract)",
      company: "Ninja Van",
      domain: "ninjavan.co",
      department: "Billing",
      seniority: "mid",
      location: JAKARTA,
      workplace: "remote",
      employment: "contract",
      salary: idr(20, 27),
      postedDaysAgo: 3,
      applyUrl: "https://jobs.lever.co/ninjavan/",
      blurb: "Six-month contract to migrate shipper billing to the new ledger.",
      requirements: ["Go", "Data migrations", "PostgreSQL"],
    },
  },
  // Deel (Ashby)
  {
    source: 2,
    job: {
      title: "Senior Backend Engineer, Payroll",
      company: "Deel",
      domain: "deel.com",
      department: "Global Payroll",
      seniority: "senior",
      location: REMOTE_ANY,
      workplace: "remote",
      employment: "full_time",
      salary: usd(110, 150),
      postedDaysAgo: 1,
      applyUrl: "https://jobs.ashbyhq.com/deel/",
      blurb: "Payroll engines for 100+ countries, Indonesia included.",
      requirements: [
        "Node.js or TypeScript",
        "PostgreSQL",
        "Payroll or tax domain",
      ],
    },
  },
  {
    source: 2,
    triage: "seen",
    job: {
      title: "Backend Engineer, Payments",
      company: "Deel",
      domain: "deel.com",
      department: "Payments",
      seniority: "mid",
      location: REMOTE_APAC,
      workplace: "remote",
      employment: "full_time",
      salary: usd(75, 105),
      postedDaysAgo: 2,
      applyUrl: "https://jobs.ashbyhq.com/deel/",
      blurb: "Pay contractors in local currency, on time, everywhere.",
      requirements: ["TypeScript", "Payment providers", "Idempotent APIs"],
    },
  },
  {
    source: 2,
    job: {
      title: "Staff Software Engineer, Platform",
      company: "Deel",
      domain: "deel.com",
      department: "Platform",
      seniority: "staff",
      location: REMOTE_ANY,
      workplace: "remote",
      employment: "full_time",
      salary: usd(160, 210),
      postedDaysAgo: 4,
      applyUrl: "https://jobs.ashbyhq.com/deel/",
      blurb:
        "Set the technical direction for the services every product team builds on.",
      requirements: [
        "10+ years experience",
        "Distributed systems",
        "Technical leadership",
      ],
    },
  },
  {
    source: 2,
    job: {
      title: "Software Engineer, Integrations",
      company: "Deel",
      domain: "deel.com",
      department: "Integrations",
      seniority: "mid",
      location: REMOTE_APAC,
      workplace: "remote",
      employment: "full_time",
      salary: usd(70, 95),
      postedDaysAgo: 6,
      applyUrl: "https://jobs.ashbyhq.com/deel/",
      blurb: "Sync HR data with accounting and identity providers.",
      requirements: ["TypeScript", "REST and webhooks", "OAuth"],
    },
  },
  {
    source: 2,
    job: {
      title: "Backend Engineer, Compliance",
      company: "Deel",
      domain: "deel.com",
      department: "Compliance",
      seniority: "mid",
      location: SINGAPORE,
      workplace: "hybrid",
      employment: "full_time",
      salary: usd(90, 120),
      postedDaysAgo: 8,
      applyUrl: "https://jobs.ashbyhq.com/deel/",
      blurb: "Automate KYC and contract compliance checks for the APAC region.",
      requirements: ["Node.js", "Rules engines", "Security mindset"],
    },
  },
];

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const DEMO_SKILLS = [
  "Go",
  "TypeScript",
  "Node.js",
  "PostgreSQL",
  "Redis",
  "Kafka",
  "Docker",
  "Kubernetes",
  "gRPC",
  "REST API design",
  "System design",
  "AWS",
];

export const DEMO_TARGET_TITLES = [
  "Backend Engineer",
  "Senior Backend Engineer",
  "Software Engineer, Backend",
  "Senior Software Engineer",
];

export interface DemoAnswer {
  answer: string;
  answer_kind: "text" | "choice" | "number" | "boolean" | "date";
  auto_use: "never" | "approval" | "always";
  match_patterns: string[];
  question_key: string;
  sensitivity: "none" | "personal" | "protected";
}

export const DEMO_ANSWERS: DemoAnswer[] = [
  {
    question_key: "availability.notice_period",
    match_patterns: ["notice period", "when can you start", "earliest start"],
    answer: "One month",
    answer_kind: "text",
    sensitivity: "none",
    auto_use: "always",
  },
  {
    question_key: "work_authorization.indonesia",
    match_patterns: [
      "authorized to work in indonesia",
      "work permit indonesia",
    ],
    answer: "Yes",
    answer_kind: "choice",
    sensitivity: "protected",
    auto_use: "approval",
  },
  {
    question_key: "compensation.expected_salary",
    match_patterns: [
      "expected salary",
      "salary expectation",
      "gaji yang diharapkan",
    ],
    answer: "IDR 45,000,000 per month",
    answer_kind: "text",
    sensitivity: "personal",
    auto_use: "approval",
  },
  {
    question_key: "relocation.willing",
    match_patterns: ["willing to relocate", "open to relocation"],
    answer: "Yes, to Singapore",
    answer_kind: "text",
    sensitivity: "none",
    auto_use: "approval",
  },
  {
    question_key: "experience.years_go",
    match_patterns: ["years of experience with go", "golang experience"],
    answer: "5",
    answer_kind: "number",
    sensitivity: "none",
    auto_use: "always",
  },
];

export interface DemoRule {
  allowed_domains?: string[];
  criteria: Record<string, unknown>;
  enabled: boolean;
  limits: Record<string, unknown>;
  mode: "assisted" | "approval" | "auto";
  name: string;
}

const SCORE_CRITERIA = {
  require_ai_component: false,
  max_score_age_days: 14,
  exclude_blocking_gates: true,
  exclude_possible_gates: false,
};

export const DEMO_RULES: DemoRule[] = [
  {
    name: "Backend roles in Jakarta",
    mode: "approval",
    enabled: true,
    criteria: {
      ...SCORE_CRITERIA,
      min_score: 65,
      title_patterns: ["backend", "software engineer"],
      locations: ["Jakarta"],
      workplace_types: ["hybrid", "onsite"],
    },
    limits: {
      max_per_day: 5,
      max_per_company_per_30d: 2,
      active_hours: { start: "08:00", end: "21:00" },
    },
  },
  {
    name: "Remote Go roles (assisted)",
    mode: "assisted",
    enabled: true,
    criteria: {
      ...SCORE_CRITERIA,
      min_score: 60,
      keywords: ["Go", "Golang"],
      workplace_types: ["remote"],
    },
    limits: { max_per_day: 3, max_per_company_per_30d: 1 },
  },
  {
    name: "Auto-apply: Greenhouse payments roles 85+",
    mode: "auto",
    enabled: false,
    criteria: {
      ...SCORE_CRITERIA,
      min_score: 85,
      require_ai_component: true,
      keywords: ["payments"],
      exclude_possible_gates: true,
    },
    limits: { max_per_day: 2, max_per_company_per_30d: 1 },
    allowed_domains: ["greenhouse.io"],
  },
];

/** A fictional base CV for the persona (CVData of packages/cv-engine). */
export function demoCv(email: string): Record<string, unknown> {
  return {
    personalInfo: {
      fullName: `${DEMO_PERSONA.first} ${DEMO_PERSONA.last}`,
      jobTitle: "Senior Backend Engineer",
      email,
      phone: DEMO_PERSONA.phone,
      location: DEMO_PERSONA.location,
      linkedIn: "nadia-rahmawati-demo",
      photoUrl: "",
      usePhoto: false,
    },
    sectionOrder: [
      "summary",
      "experience",
      "education",
      "skills",
      "awards",
      "certificates",
      "languages",
      "projects",
      "volunteer",
    ],
    summaryTitle: "Professional Summary",
    summary:
      "Backend engineer with 6 years of experience building payment and logistics systems in Go and TypeScript. Led a ledger migration that cut reconciliation incidents by 80%. Comfortable owning services from design to on-call.",
    experienceTitle: "Work Experience",
    experience: [
      {
        id: "exp-1",
        company: "PT Kirim Cepat Nusantara",
        url: "",
        title: "Senior Backend Engineer",
        workType: "full-time",
        locationPolicy: "hybrid",
        startDate: "2022-03",
        endDate: "",
        current: true,
        description:
          "Led the migration of the shipment ledger from MySQL to PostgreSQL with zero downtime\nDesigned idempotent payment APIs in Go handling 2,000 requests per second\nMentored four engineers and ran the backend on-call rotation",
      },
      {
        id: "exp-2",
        company: "PT Dompet Digital Indonesia",
        url: "",
        title: "Backend Engineer",
        workType: "full-time",
        locationPolicy: "work-from-office",
        startDate: "2019-07",
        endDate: "2022-02",
        current: false,
        description:
          "Built top-up and transfer services in Go and Kafka\nCut p99 latency of the balance service from 400 ms to 90 ms with Redis caching\nWrote the reconciliation jobs that matched bank statements daily",
      },
      {
        id: "exp-3",
        company: "Startup Studio Bandung",
        url: "",
        title: "Software Engineer Intern",
        workType: "internship",
        locationPolicy: "work-from-office",
        startDate: "2018-06",
        endDate: "2018-12",
        current: false,
        description:
          "Built REST APIs in Node.js for a school management product\nSet up CI with GitHub Actions and Docker",
      },
    ],
    educationTitle: "Education",
    education: [
      {
        id: "edu-1",
        category: "university",
        institution: "Institut Teknologi Bandung",
        degree: "Bachelor of Computer Science",
        gpa: "3.62",
        startDate: "2015-08",
        endDate: "2019-07",
        current: false,
      },
    ],
    skillsTitle: "Skills",
    skills: [
      {
        id: "skill-cat-1",
        name: "Languages",
        items: ["Go", "TypeScript", "SQL", "Python"],
      },
      {
        id: "skill-cat-2",
        name: "Backend",
        items: ["PostgreSQL", "Redis", "Kafka", "gRPC", "REST API design"],
      },
      {
        id: "skill-cat-3",
        name: "Infrastructure",
        items: ["Docker", "Kubernetes", "AWS", "Terraform", "Grafana"],
      },
    ],
    awardsTitle: "Awards",
    awards: [],
    certificatesTitle: "Certificates",
    certificates: [],
    languagesTitle: "Languages",
    languages: [
      { id: "lang-1", language: "Indonesian", proficiency: "Native" },
      { id: "lang-2", language: "English", proficiency: "Professional" },
    ],
    projectsTitle: "Projects",
    projects: [],
    volunteerTitle: "Volunteer",
    volunteer: [],
  };
}
