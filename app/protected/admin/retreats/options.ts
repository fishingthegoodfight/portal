import { timezoneOptions, type Chapter, type Region } from "@/lib/chapters";
import { waiverStateName, waiverStatesForChapters } from "@/lib/waivers";
import { US_STATES } from "@/lib/us-states";

/** The select options the retreat create and setup forms share. */
export function retreatFormOptions(regions: Region[], chapters: Chapter[], keep: { timezone?: string; state?: string; regionId?: number } = {}) {
  const chapterStates = waiverStatesForChapters(chapters);
  const states = [...chapterStates, ...US_STATES.filter((s) => !chapterStates.includes(s))];
  return {
    regions: regions
      .filter((r) => r.active || r.id === keep.regionId)
      .map((r) => ({ value: String(r.id), label: r.name })),
    timezones: timezoneOptions(chapters, keep.timezone),
    waiverStates: states.map((s) => ({ value: s, label: `${waiverStateName(s)} (${s})` })),
  };
}
