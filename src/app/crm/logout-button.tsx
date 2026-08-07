"use client";

export function LogoutButton({ base, label = "Sign out" }: { base: string; label?: string }) {
  async function logout() {
    await fetch(`${base}/api/logout`, { method: "POST" }).catch(() => {});
    window.location.href = `${base}/login`;
  }
  return (
    <button type="button" className="crm-btn crm-btn-ghost" onClick={logout}>
      {label}
    </button>
  );
}
