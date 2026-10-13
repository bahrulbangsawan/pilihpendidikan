// The documents the snapshot tests render. SAMPLE is apps/cv's prefill
// (src/data/sample-cv.json) frozen as a fixture; EXTENDED adds what the sample
// leaves out (awards, volunteer work, a photo, empty and repeated lines,
// stray whitespace, accents, a tab, an arrow and an emoji); EMPTY is a blank
// document as the builder starts one.
import type { CVData } from "../src/types";
import sample from "./fixtures/sample-cv.json";

export const SAMPLE = sample as CVData;

// A 1×1 PNG, enough to exercise the photo frame.
const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export const EXTENDED: CVData = {
  ...SAMPLE,
  style: "harvard",
  personalInfo: {
    ...SAMPLE.personalInfo,
    fullName: "Zoë  Núñez-Dvořák",
    photoUrl: PHOTO,
    usePhoto: true,
  },
  sectionOrder: [
    "volunteer",
    "awards",
    "summary",
    "experience",
    "projects",
    "education",
    "skills",
    "languages",
    "certificates",
  ],
  summary:
    "First line\n\nSecond line after a blank one\r\nThird\tline → done ✨\n",
  experience: [
    {
      id: "exp-a",
      company: "Acme",
      url: "acme.example",
      title: "Engineer",
      workType: "",
      locationPolicy: "",
      startDate: "2020-01",
      endDate: "2021-06",
      current: false,
      description:
        "  Built things  \n\nBuilt things\nShipped v2 to 10,000 users\n",
    },
    {
      id: "exp-b",
      company: "Beta",
      url: "",
      title: "Lead",
      workType: "full-time",
      locationPolicy: "hybrid",
      startDate: "2021-07",
      endDate: "2023-01",
      current: true,
      description: "",
    },
  ],
  certificates: SAMPLE.certificates.slice(0, 3),
  projects: [
    ...SAMPLE.projects.slice(0, 2),
    { id: "proj-x", name: "Untitled", url: "", description: "" },
  ],
  awards: [
    {
      id: "award-1",
      title: "Best Paper",
      issuer: "ACL",
      date: "2022-05",
      description: "Awarded for work on retrieval\nPresented in Dublin",
      url: "https://example.org/award",
    },
    {
      id: "award-2",
      title: "Hackathon winner",
      issuer: "Devfest",
      date: "2019-11",
      description: "",
      url: "",
    },
  ],
  volunteerTitle: "Community",
  volunteer: [
    {
      id: "vol-1",
      organization: "Code Club",
      role: "Mentor",
      startDate: "2018-02",
      endDate: "",
      current: true,
      description: "Taught weekly sessions\nRan the yearly showcase",
    },
  ],
};

export const EMPTY: CVData = {
  personalInfo: {
    fullName: "",
    jobTitle: "",
    email: "",
    phone: "",
    location: "",
    linkedIn: "",
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
  summary: "",
  experienceTitle: "Work Experience",
  experience: [],
  educationTitle: "Education",
  education: [],
  skillsTitle: "Skills",
  skills: [],
  awardsTitle: "Awards",
  awards: [],
  certificatesTitle: "Certificates",
  certificates: [],
  languagesTitle: "Languages",
  languages: [],
  projectsTitle: "Projects",
  projects: [],
  volunteerTitle: "Volunteer & Community",
  volunteer: [],
};

/** The documents T8-01 renders with every template. */
export const PDF_CASES: Readonly<Record<string, CVData>> = {
  sample: SAMPLE,
  extended: EXTENDED,
};

/** The documents TCV-MARKDOWN exports. */
export const MARKDOWN_CASES: Readonly<Record<string, CVData>> = {
  sample: SAMPLE,
  extended: EXTENDED,
  empty: EMPTY,
};
