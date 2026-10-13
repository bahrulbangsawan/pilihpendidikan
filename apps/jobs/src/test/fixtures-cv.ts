// A fictional tailored CV (the person and companies are invented) whose
// entry ids match makeDiff() in fixtures-rest.ts: the CV tab's tests label
// the diff with it, and the mock api serves it to the render page, which
// renders a real PDF from it in the browser.

import { createEmptyCV } from "@pilihpendidikan/cv-engine/document";
import { CVDataSchema } from "@pilihpendidikan/cv-engine/schema";
import type { CVData } from "@pilihpendidikan/cv-engine/types";

export function sampleTailoredCv(): CVData {
  const cv = createEmptyCV();
  const data: CVData = {
    ...cv,
    style: "standard",
    visibility: "private",
    personalInfo: {
      fullName: "Rina Wulandari",
      jobTitle: "Frontend Engineer",
      email: "rina.wulandari@example.com",
      phone: "+62 812 3456 7890",
      location: "Jakarta, Indonesia",
      linkedIn: "",
      photoUrl: "",
      usePhoto: false,
    },
    sectionOrder: ["summary", "skills", "experience", "projects", "education"],
    summary:
      "Frontend engineer with five years of React and accessibility work in education technology.",
    experience: [
      {
        id: "exp-1",
        company: "Belajar Bersama",
        url: "",
        title: "Frontend Engineer",
        workType: "full-time",
        locationPolicy: "hybrid",
        startDate: "2022-02",
        endDate: "",
        current: true,
        description:
          "Led the migration of the teacher dashboard to React 18.\nBuilt an accessible component library used by 4 product teams.",
      },
      {
        id: "exp-2",
        company: "Toko Kita",
        url: "",
        title: "Web Developer",
        workType: "full-time",
        locationPolicy: "work-from-office",
        startDate: "2019-07",
        endDate: "2022-01",
        current: false,
        description:
          "Cut page load time by 40% with code splitting and image work.\nMentored two junior engineers.",
      },
    ],
    education: [
      {
        id: "edu-1",
        category: "university",
        institution: "Universitas Nusantara",
        degree: "S.Kom., Informatics",
        gpa: "",
        startDate: "2015-08",
        endDate: "2019-06",
        current: false,
      },
    ],
    skills: [
      {
        id: "sk-1",
        name: "Frontend",
        items: ["React", "TypeScript", "Accessibility", "Testing"],
      },
    ],
    projects: [
      {
        id: "p-1",
        name: "Kelas Terbuka",
        url: "",
        description: "An open course catalogue for teachers.",
      },
    ],
  };
  return CVDataSchema.parse(data) as CVData;
}
