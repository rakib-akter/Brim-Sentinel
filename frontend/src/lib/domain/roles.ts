import type { RoleId, User } from "./types";

/**
 * Role descriptions from PRD §3 / §4A. Display-only: limits shown here explain
 * the UI; the backend is the only source of financial authorization.
 */
export interface RoleDefinition {
  id: RoleId;
  label: string;
  can: string;
  cannot: string;
}

export const ROLES: Record<RoleId, RoleDefinition> = {
  requester: {
    id: "requester",
    label: "Requester",
    can: "Submit invoices and follow your own submissions.",
    cannot: "Approve, pay, or see other departments' invoices.",
  },
  ap_clerk: {
    id: "ap_clerk",
    label: "AP Clerk",
    can: "Review invoices, fix extraction and coding, investigate, prepare payments.",
    cannot: "Approve invoices or release payments.",
  },
  dept_approver: {
    id: "dept_approver",
    label: "Department Approver",
    can: "Approve your department's invoices up to CAD 10,000.",
    cannot: "Release payments or edit bank details.",
  },
  finance_manager: {
    id: "finance_manager",
    label: "Finance Manager",
    can: "Approve up to CAD 50,000, authorize payment-route changes, release up to CAD 100,000.",
    cannot: "Release any invoice you approved.",
  },
  controller: {
    id: "controller",
    label: "Controller",
    can: "Approve up to CAD 250,000, administer policies, release above CAD 100,000.",
    cannot: "Bypass separation of duties.",
  },
  cfo: {
    id: "cfo",
    label: "CFO",
    can: "Fill the CFO approval step (over CAD 250,000) and release as controller.",
    cannot: "Release an invoice you approved.",
  },
  auditor: {
    id: "auditor",
    label: "Auditor",
    can: "Read everything and export audit records.",
    cannot: "Change any record.",
  },
};

/** Synthetic Harborline Logistics users — demo identities, not authentication. */
export const DEMO_USERS: User[] = [
  { id: "U007", name: "Jordan Ellis", initials: "JE", title: "AP Clerk", role: "ap_clerk", department: "Finance" },
  { id: "U020", name: "Sam Okoro", initials: "SO", title: "Dispatch Coordinator", role: "requester", department: "Operations" },
  { id: "U009", name: "Amélie Gagnon", initials: "AG", title: "Operations Manager", role: "dept_approver", department: "Operations" },
  { id: "U003", name: "Priya Raman", initials: "PR", title: "Finance Manager", role: "finance_manager", department: "Finance" },
  { id: "U002", name: "Marcus Lindqvist", initials: "ML", title: "Controller", role: "controller", department: "Finance" },
  { id: "U001", name: "Evelyn Hart", initials: "EH", title: "Chief Financial Officer", role: "cfo", department: "Executive" },
  { id: "U030", name: "Nadia Rossi", initials: "NR", title: "Internal Auditor", role: "auditor", department: "Audit" },
];

export const DEFAULT_USER_ID = "U007";

export function findUser(id: string): User {
  return DEMO_USERS.find((u) => u.id === id) ?? DEMO_USERS[0]!;
}
