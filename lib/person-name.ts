/** A person's name for lists (rosters, check-in, print views): first and
 * last name, or their email when no name is on file — never a blank line. */
export function personDisplayName(person: { firstName: string; lastName: string; email: string }): string {
  return [person.firstName, person.lastName].filter((n) => n?.trim()).join(" ") || person.email || "No name on file";
}
