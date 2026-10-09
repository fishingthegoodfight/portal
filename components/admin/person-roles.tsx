"use client";

import { useRouter } from "next/navigation";

import { PersonRow, type RolePerson } from "@/components/admin/roles-manager";

/** The contact profile's site role and sensitive-data access: People &
 * roles' row for this one person. A delete leaves for Members, since the
 * profile is gone. */
export function PersonRoles({
  person,
  isSelf,
  chapterOptions,
}: {
  person: RolePerson;
  isSelf: boolean;
  chapterOptions: string[];
}) {
  const router = useRouter();
  return (
    <PersonRow
      person={person}
      isSelf={isSelf}
      chapterOptions={chapterOptions}
      onProfile
      onDeleted={() => router.push("/protected/members?chapter=all&view=everyone")}
    />
  );
}
