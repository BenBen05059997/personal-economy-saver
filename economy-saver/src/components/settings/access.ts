import { accountMembership } from "@/db/account";
import type { Db } from "@/db/household";

type Identity = { uid: string } | null;

/** Whether the person may manage the household: its owner, or anyone in a Try it household. Owner-only routes check again. */
export async function householdRole(tx: Db, hid: string, identity: Identity, demo: boolean) {
  const membership = identity ? await accountMembership(tx, identity.uid) : null;
  const isOwner = Boolean(identity && membership?.householdId === hid && membership.role === "owner");
  return { membership, isOwner, canManage: demo || isOwner };
}
