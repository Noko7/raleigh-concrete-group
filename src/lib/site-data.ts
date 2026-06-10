// ── Raleigh Concrete Group — central site data ──────────────────────────────
// Edit content here; the homepage, location pages, header and SEO all read from it.

export const businessName = "Raleigh Concrete Group";
export const phoneDisplay = "(919) 555-0199"; // TODO: replace with your real tracking number
export const phoneHref = "tel:+19195550199";
export const textHref = "sms:+19195550199";

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
      "New concrete driveway installation and replacement in Raleigh, NC. Properly based, poured and finished to handle daily use and NC weather — built to last.",
    tier: "primary",
  },
  {
    name: "Paver Patios",
    description:
      "Custom paver patios and outdoor living spaces that add curb appeal and value. A wide range of styles, colors and layouts to fit your yard.",
    tier: "primary",
  },
  {
    name: "Retaining Walls",
    description:
      "Engineered concrete and block retaining walls for grading, drainage and erosion control — clean lines that hold up for decades.",
    tier: "primary",
  },
  {
    name: "Concrete Patios",
    description:
      "Poured, stamped or broom-finished concrete patios built flat, square and to last for backyards across the Triangle.",
    tier: "secondary",
  },
  {
    name: "Walkways & Sidewalks",
    description:
      "Concrete and paver walkways, paths and sidewalks — safe, level and tied neatly into your landscape.",
    tier: "secondary",
  },
  {
    name: "Stamped & Decorative Concrete",
    description:
      "Stamped, colored and textured concrete that mimics stone or brick for a fraction of the cost of natural materials.",
    tier: "secondary",
  },
  {
    name: "Concrete Slabs & Flatwork",
    description:
      "Garage pads, shed and AC pads, foundations and equipment slabs poured flat, square and to spec.",
    tier: "addon",
  },
  {
    name: "Concrete Repair & Resurfacing",
    description:
      "Fix cracked, settling or worn concrete and resurface tired surfaces — no full tear-out required.",
    tier: "addon",
  },
];

export const valueProps = [
  "On Time, Every Time",
  "Licensed & Insured",
  "Workmanship Warranty",
];

export type GalleryImage = { src: string; alt: string };

// NOTE: placeholder photos — replace with your contractor partner's real
// before/after concrete & hardscape project photos (with permission).
export const galleryImages: GalleryImage[] = [
  { src: "/images/project-01.jpg", alt: "Finished concrete driveway in Raleigh" },
  { src: "/images/project-02.jpg", alt: "Custom paver patio project" },
  { src: "/images/project-03.jpg", alt: "Concrete retaining wall installation" },
  { src: "/images/project-04.jpg", alt: "Stamped concrete patio" },
  { src: "/images/project-05.jpg", alt: "Concrete walkway and sidewalk" },
  { src: "/images/project-06.jpg", alt: "Concrete slab and flatwork pour" },
  { src: "/images/project-07.jpg", alt: "Resurfaced concrete surface" },
  { src: "/images/project-08.jpg", alt: "Backyard hardscape project" },
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
    before: "/images/before-after-1-before.jpg",
    after: "/images/before-after-1-after.jpg",
    label: "Driveway Replacement",
  },
  {
    before: "/images/before-after-2-before.jpg",
    after: "/images/before-after-2-after.jpg",
    label: "Patio Upgrade",
  },
];

export const locations: Record<LocationKey, LocationContent> = {
  raleigh: {
    key: "raleigh",
    city: "Raleigh",
    title: "Concrete & Hardscaping in Raleigh, NC",
    seoTitle: "Concrete Raleigh NC | Driveways, Patios & Pavers",
    description:
      "Concrete driveways, patios, walkways and retaining walls for homeowners across Raleigh. Licensed, insured and on time — free same-day quotes.",
    heroImage: "/images/project-01.jpg",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["North Hills", "Five Points", "Brier Creek", "Midtown", "North Raleigh"],
  },
  cary: {
    key: "cary",
    city: "Cary",
    title: "Concrete & Hardscaping in Cary, NC",
    seoTitle: "Concrete Cary NC | Driveways, Patios & Pavers",
    description:
      "From driveways to custom paver patios, durable concrete and hardscaping for Cary homes — fair pricing and a clean job site.",
    heroImage: "/images/project-02.jpg",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Preston", "Amberly", "Highcroft", "MacGregor Downs", "West Cary"],
  },
  apex: {
    key: "apex",
    city: "Apex",
    title: "Concrete & Hardscaping in Apex, NC",
    seoTitle: "Concrete Apex NC | Driveways, Patios & Pavers",
    description:
      "Low-maintenance, high-performance concrete and hardscaping for Apex homeowners — driveways, stamped patios, walkways and retaining walls.",
    heroImage: "/images/project-03.jpg",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Haddon Hall", "Bella Casa", "Scotts Mill", "Villages of Apex", "Downtown Apex"],
  },
  "wake-forest": {
    key: "wake-forest",
    city: "Wake Forest",
    title: "Concrete & Hardscaping in Wake Forest, NC",
    seoTitle: "Concrete Wake Forest NC | Driveways, Patios & Pavers",
    description:
      "New driveways, patios and retaining walls with quick turnarounds in Wake Forest — built right and backed by warranty.",
    heroImage: "/images/project-04.jpg",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Heritage", "Traditions", "Holding Village", "Wakefield", "Stonegate"],
  },
  durham: {
    key: "durham",
    city: "Durham",
    title: "Concrete & Hardscaping in Durham, NC",
    seoTitle: "Concrete Durham NC | Driveways, Patios & Pavers",
    description:
      "Commercial-grade concrete and hardscaping with clean installs across Durham — driveways, patios, walkways and retaining walls.",
    heroImage: "/images/project-05.jpg",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Southpoint", "Hope Valley", "Brightleaf", "Trinity Park", "Woodcroft"],
  },
};

export const testimonials = [
  {
    name: "Mark T.",
    city: "Raleigh",
    quote:
      "Showed up exactly when they said, quoted fair, and our new driveway looks fantastic. Cleanest job site I've ever seen.",
  },
  {
    name: "Jasmine R.",
    city: "Cary",
    quote:
      "Got a same-day quote, the crew built our paver patio in two days, and it's the best part of our backyard now.",
  },
  {
    name: "Chris D.",
    city: "Apex",
    quote:
      "Finally a contractor who answers the phone. Retaining wall fixed our drainage and looks great. Fair price, no surprises.",
  },
];
