/** The issue body, in the same "### Label" form GitHub issue forms write and the grading bot reads. */
export function issueBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([label, value]) => `### ${label}\n\n${value.trim() || "_No response_"}`)
    .join("\n\n");
}
