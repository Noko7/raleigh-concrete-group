// Public by nature (in every page's script tag). NEXT_PUBLIC_CLARITY_PROJECT_ID overrides it.
// Own module because clarity.tsx is "use client": a server import from it gets a reference, not the value.
export const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || "ymldax22ww";
