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

// With no allowlist configured, fall back to the company domain (from the site URL) rather than failing
// open to any account. CRM_ALLOWED_EMAILS / CRM_ALLOWED_DOMAINS override it.
function companyDomain(): string {
  try {
    const url = process.env.NEXT_PUBLIC_SITE_URL || "https://raleighconcrete.net";
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "raleighconcrete.net";
  }
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  const at = normalized.lastIndexOf("@");
  if (at < 0) return false;
  const domain = normalized.slice(at + 1);
  if (!allowedEmails.size && !allowedDomains.size) return domain === companyDomain();
  if (allowedEmails.has(normalized)) return true;
  return allowedDomains.has(domain);
}

export function isRoleAllowed(role: string | null | undefined): boolean {
  if (!role) return false;
  if (!allowedRoles.size) return true;
  return allowedRoles.has(role.toLowerCase());
}

// The single gate every sign-in path uses.
// Contractors skip the email allowlist (crew use personal addresses); their authorisation is an active
// contractor row, which only an owner can produce (signups create inactive rows).
// Owners stay on the allowlist: they manage staff and see every customer.
export function isStaffAllowed(
  role: string | null | undefined,
  email: string | null | undefined,
): boolean {
  if (!isRoleAllowed(role)) return false;
  if (role === "contractor") return true;
  return isEmailAllowed(email);
}

