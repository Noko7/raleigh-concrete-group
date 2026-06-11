import type { Role } from "./types";

function parseCsv(envValue: string | undefined): Set<string> {
  return new Set(
    (envValue ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
}

const allowedEmails = parseCsv(process.env.CRM_ALLOWED_EMAILS);
const allowedDomains = parseCsv(process.env.CRM_ALLOWED_DOMAINS);
const allowedRoles = parseCsv(process.env.CRM_ALLOWED_ROLES);

export function isEmailAllowed(email: string | null | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (!allowedEmails.size && !allowedDomains.size) return true;
  if (allowedEmails.has(normalized)) return true;
  const at = normalized.lastIndexOf("@");
  if (at < 0) return false;
  const domain = normalized.slice(at + 1);
  return allowedDomains.has(domain);
}

export function isRoleAllowed(role: Role | null | undefined): boolean {
  if (!role) return false;
  if (!allowedRoles.size) return true;
  return allowedRoles.has(role.toLowerCase());
}

