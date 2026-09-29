import {
  experienceFromRow,
  type ExperienceInput,
  type ExperienceRow,
  type InterestArea,
} from "@/lib/volunteer-applications";
import { PROGRAM_INTERESTS, SKILL_INTERESTS } from "@/lib/volunteers";
import { homeChapterOption, type Chapter } from "@/lib/chapters";

/**
 * Registration answers carried over from an approved application (phase 4):
 * skills and interest areas, programs, and the fly fishing, certification
 * and availability answers. Only ever a starting point — the registration
 * form shows a line saying where they came from, and every one can be
 * changed.
 *
 * Interest areas match the registration form's lists by wording (see the
 * note on InterestArea): an area reworded in Setup no longer carries over.
 * The application's retreat question becomes the "Retreats" program.
 */
export type RegistrationPrefill = {
  applicationId: number;
  appliedOn: string;
  /** The chapter they applied for — used only when the profile has none. */
  chapter: string;
  skillInterests: string[];
  skillInterestsOther: string;
  programInterests: string[];
  experience: ExperienceInput;
};

export function prefillFromApplication(
  app: ExperienceRow & {
    id: number;
    submitted_at: string;
    interest_area_ids: number[];
    interest_other: string | null;
    interested_in_retreats: boolean;
    chapters: string[];
  },
  areas: Pick<InterestArea, "id" | "kind" | "label">[],
  chapters: Chapter[],
): Omit<RegistrationPrefill, "appliedOn"> {
  const picked = areas.filter((a) => (app.interest_area_ids ?? []).includes(a.id));
  const pickedLabels = (kind: InterestArea["kind"]) => new Set(picked.filter((a) => a.kind === kind).map((a) => a.label));
  const skills = pickedLabels("skill");
  const programs = pickedLabels("program");
  const other = app.interest_other?.trim() ?? "";
  // In the registration form's own order.
  const skillInterests: string[] = SKILL_INTERESTS.filter((s) => skills.has(s));
  if (other) skillInterests.push("Other");
  const programInterests: string[] = PROGRAM_INTERESTS.filter(
    (p) => programs.has(p) || (p === "Retreats" && app.interested_in_retreats),
  );
  return {
    applicationId: app.id,
    chapter: homeChapterOption(app.chapters?.[0], chapters),
    skillInterests,
    skillInterestsOther: other,
    programInterests,
    experience: experienceFromRow(app),
  };
}
