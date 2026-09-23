// Microsoft Clarity project for raleighconcrete.net (Clarity -> Settings ->
// Overview -> Project ID). Public by nature - it sits in every page's script
// tag - so it lives here rather than as a secret. NEXT_PUBLIC_CLARITY_PROJECT_ID
// in Vercel overrides it, e.g. to point a preview at a different project.
//
// Its own module, not an export of clarity.tsx: that file is "use client", and
// a server component importing a value from one gets a reference, not the value.
export const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || "ymldax22ww";
