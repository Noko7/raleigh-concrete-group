// ── Raleigh Concrete Group — central site data ──────────────────────────────
// Edit content here; the homepage, location pages, header and SEO all read from it.

export const businessName = "Raleigh Concrete Group";
export const phoneDisplay = "(919) 420-3146";
export const phoneHref = "tel:+19194203146";
export const textHref = "sms:+19194203146";

export type LocationKey = "raleigh" | "cary" | "apex" | "wake-forest" | "durham";

export const locationKeys: LocationKey[] = [
  "raleigh",
  "cary",
  "apex",
  "wake-forest",
  "durham",
];

export type Service = {
  name: string;
  description: string;
  tier: "primary" | "secondary" | "addon";
};

export const services: Service[] = [
  {
    name: "Concrete Driveways",
    description:
      "We pour and replace concrete driveways all over Raleigh. Every one gets a proper base and a clean finish, so it handles daily traffic and our North Carolina weather without falling apart.",
    tier: "primary",
  },
  {
    name: "Paver Patios",
    description:
      "Custom paver patios that turn your backyard into a place you actually want to spend time. Pick the style, color and layout that fits your home — we'll handle the rest.",
    tier: "primary",
  },
  {
    name: "Retaining Walls",
    description:
      "Solid concrete and block retaining walls that take care of grading, drainage and erosion. Clean lines that hold up for decades, not just a season or two.",
    tier: "primary",
  },
  {
    name: "Concrete Patios",
    description:
      "Poured, stamped or broom-finished concrete patios, built flat and square to last. A great fit for backyards across the Triangle.",
    tier: "secondary",
  },
  {
    name: "Walkways & Sidewalks",
    description:
      "Concrete and paver walkways that are safe, level and easy to walk on — and they tie right into the rest of your yard.",
    tier: "secondary",
  },
  {
    name: "Stamped & Decorative Concrete",
    description:
      "Stamped, colored and textured concrete that looks like real stone or brick, for a fraction of what the real thing would cost you.",
    tier: "secondary",
  },
  {
    name: "Concrete Slabs & Flatwork",
    description:
      "Garage pads, shed and AC pads, foundations and equipment slabs — poured flat, square and right to spec.",
    tier: "addon",
  },
  {
    name: "Concrete Repair & Resurfacing",
    description:
      "Cracked, sinking or worn-out concrete? We fix it and resurface it, so you don't have to pay to tear the whole thing out.",
    tier: "addon",
  },
];

export const valueProps = [
  "We Show Up On Time",
  "Licensed & Insured",
  "Backed By Our Warranty",
];

export type GalleryImage = { src: string; alt: string };

export const galleryImages: GalleryImage[] = [
  { src: "/images/after_driveway.png", alt: "Finished concrete driveway in Raleigh" },
  { src: "/images/back_patio_finished.png", alt: "Finished backyard concrete patio" },
  { src: "/images/retaining_wall.png", alt: "Block retaining wall installation" },
  { src: "/images/stamped_patio.png", alt: "Stamped concrete patio" },
  { src: "/images/stampted_patio_2.png", alt: "Stamped concrete patio detail" },
  { src: "/images/driveway_close_up_detailed_8k.png", alt: "Broom-finished concrete driveway close-up" },
  { src: "/images/workers_pouring_driveway_live_action.png", alt: "Our crew pouring a new concrete driveway" },
  { src: "/images/after_cracked_concrete_driveway.png", alt: "Repaired and resurfaced concrete driveway" },
];

export const links = {
  call: phoneHref,
  text: textHref,
  quote: "#quote",
};

export type BeforeAfterPair = {
  before: string;
  after: string;
  label: string;
};

export type LocationContent = {
  key: LocationKey;
  city: string;
  title: string;
  seoTitle: string;
  description: string;
  heroImage: string;
  beforeAfterPairs: BeforeAfterPair[];
  neighborhoods: string[];
};

const sharedBeforeAfter: BeforeAfterPair[] = [
  {
    before: "/images/before_driveway.png",
    after: "/images/after_driveway.png",
    label: "Driveway Replacement",
  },
  {
    before: "/images/back_patio_before.png",
    after: "/images/back_patio_after.png",
    label: "Backyard Patio",
  },
  {
    before: "/images/before_cracked_concrete_driveway.png",
    after: "/images/after_cracked_concrete_driveway.png",
    label: "Cracked Driveway Repair",
  },
];

export const locations: Record<LocationKey, LocationContent> = {
  raleigh: {
    key: "raleigh",
    city: "Raleigh",
    title: "Concrete & Hardscaping in Raleigh, NC",
    seoTitle: "Concrete Raleigh NC | Driveways, Patios & Pavers",
    description:
      "We build concrete driveways, patios, walkways and retaining walls for homeowners all over Raleigh. We're licensed, insured, and we show up when we say we will. Quotes are free, usually the same day.",
    heroImage: "/images/after_driveway.png",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["North Hills", "Five Points", "Brier Creek", "Midtown", "North Raleigh"],
  },
  cary: {
    key: "cary",
    city: "Cary",
    title: "Concrete & Hardscaping in Cary, NC",
    seoTitle: "Concrete Cary NC | Driveways, Patios & Pavers",
    description:
      "From new driveways to custom paver patios, we handle concrete and hardscaping for homes in Cary. Fair pricing, and we leave your place cleaner than we found it.",
    heroImage: "/images/back_patio_finished.png",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Preston", "Amberly", "Highcroft", "MacGregor Downs", "West Cary"],
  },
  apex: {
    key: "apex",
    city: "Apex",
    title: "Concrete & Hardscaping in Apex, NC",
    seoTitle: "Concrete Apex NC | Driveways, Patios & Pavers",
    description:
      "Driveways, stamped patios, walkways and retaining walls for Apex homeowners. Low-maintenance work that looks great and holds up year after year.",
    heroImage: "/images/retaining_wall.png",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Haddon Hall", "Bella Casa", "Scotts Mill", "Villages of Apex", "Downtown Apex"],
  },
  "wake-forest": {
    key: "wake-forest",
    city: "Wake Forest",
    title: "Concrete & Hardscaping in Wake Forest, NC",
    seoTitle: "Concrete Wake Forest NC | Driveways, Patios & Pavers",
    description:
      "New driveways, patios and retaining walls in Wake Forest — usually wrapped up fast, done right, and backed by our workmanship warranty.",
    heroImage: "/images/stamped_patio.png",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Heritage", "Traditions", "Holding Village", "Wakefield", "Stonegate"],
  },
  durham: {
    key: "durham",
    city: "Durham",
    title: "Concrete & Hardscaping in Durham, NC",
    seoTitle: "Concrete Durham NC | Driveways, Patios & Pavers",
    description:
      "Clean, solid concrete and hardscaping across Durham — driveways, patios, walkways and retaining walls, all done right the first time.",
    heroImage: "/images/workers_pouring_driveway_live_action.png",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Southpoint", "Hope Valley", "Brightleaf", "Trinity Park", "Woodcroft"],
  },
};

export const testimonials = [
  {
    name: "Mark T.",
    city: "Raleigh",
    quote:
      "They showed up right when they said they would, the price was fair, and our new driveway looks fantastic. Cleanest job site I've ever seen.",
  },
  {
    name: "Jasmine R.",
    city: "Cary",
    quote:
      "I got a quote the same day, the crew built our paver patio in two days, and now it's the best part of our backyard.",
  },
  {
    name: "Chris D.",
    city: "Apex",
    quote:
      "Finally, a contractor who actually answers the phone. The retaining wall fixed our drainage problem and looks great. Fair price, no surprises.",
  },
];
