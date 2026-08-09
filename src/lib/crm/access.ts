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

// When no email/domain allowlist is configured we DON'T fail open to "anyone with
// an account". Instead we fall back to the company's own email domain (derived
// from the public site URL), so a random external signup (e.g. a gmail address)
// is rejected while owner/staff on the company domain still sign in. Set
// CRM_ALLOWED_EMAILS / CRM_ALLOWED_DOMAINS explicitly to override this default.
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
//
// Contractors are NOT held to the email allowlist. Crew use personal addresses
// (gmail, icloud) and requiring a company domain meant an owner could invite
// someone, text them credentials, and have them rejected at login with no
// explanation. Their authorisation is the active contractor row itself, which
// only an owner can produce: the signup trigger creates staff rows inactive, so
// a stray Supabase signup still can't get in on its own.
//
// The allowlist stays on owners, where it's actually load-bearing - that's the
// role that can manage staff and see every customer.
export function isStaffAllowed(
  role: string | null | undefined,
  email: string | null | undefined,
): boolean {
  if (!isRoleAllowed(role)) return false;
  if (role === "contractor") return true;
  return isEmailAllowed(email);
}

