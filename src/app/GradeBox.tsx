import type { Grade } from "@/lib/types";

export function GradeBox({ grade }: { grade: Grade | null }) {
  return <div className={`grade grade-${grade ?? "none"}`}>{grade ?? "N/A"}</div>;
}
