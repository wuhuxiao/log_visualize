import type { LogSource } from "../types/models";

export const SAMPLE_LOGS = [
  { id: "demo", name: "demo.log", path: "/samples/demo.log" },
  { id: "mixed-workers", name: "mixed-workers.log", path: "/samples/mixed-workers.log" }
];

export async function loadSampleSources(sampleIds: string[]): Promise<LogSource[]> {
  const selected = SAMPLE_LOGS.filter((sample) => sampleIds.includes(sample.id));
  return Promise.all(
    selected.map(async (sample) => {
      const response = await fetch(sample.path);
      const text = await response.text();
      return {
        id: sample.id,
        name: sample.name,
        text
      };
    })
  );
}
