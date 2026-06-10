// ── Raleigh Concrete Group — central site data ──────────────────────────────
// Edit content here; the homepage, location pages, header and SEO all read from it.

export const businessName = "Raleigh Concrete Group";
export const phoneDisplay = "(919) 897-7695";
export const phoneHref = "tel:+19198977695";
export const textHref = "sms:+19198977695";

export type LocationKey = "raleigh" | "cary" | "apex" | "wake-forest" | "durham";

export const locationKeys: LocationKey[] = [
  "raleigh",
  "cary",
  "apex",
  "wake-forest",
  "durham",
];

export type ServiceGroup = "core" | "concrete" | "hardscaping";

export type Service = {
  slug: string;
  name: string;
  navLabel: string;
  group: ServiceGroup;
  blurb: string;
  intro: string;
  bullets: string[];
  image: string;
  beforeAfter?: BeforeAfterPair;
};

export const services: Service[] = [
  // ── Core 6 (priority, shown in nav + homepage) ──
  {
    slug: "concrete-driveways",
    name: "Concrete Driveways",
    navLabel: "Driveways",
    group: "core",
    blurb:
      "New concrete driveway installation and replacement in Raleigh, built to handle daily use and NC weather.",
    intro:
      "A new concrete driveway is one of the fastest ways to boost your home's curb appeal in Raleigh. We pour and replace driveways that are properly based, cleanly finished, and built to take daily traffic and North Carolina weather for years.",
    bullets: [
      "Fresh installs or full tear-out and re-pour",
      "Proper base prep so it won't crack early",
      "Broom, smooth or stamped finishes",
      "Free same-day quote, often from satellite",
    ],
    image: "/images/after_driveway.png",
    beforeAfter: {
      before: "/images/before_driveway.png",
      after: "/images/after_driveway.png",
      label: "Driveway Replacement",
    },
  },
  {
    slug: "retaining-walls",
    name: "Retaining Walls",
    navLabel: "Retaining Walls",
    group: "core",
    blurb:
      "Engineered concrete and block retaining walls for grading, drainage and erosion control in Raleigh and across the Triangle.",
    intro:
      "If part of your yard is sliding, pooling water, or just hard to use, a retaining wall fixes it. We build engineered concrete and block retaining walls across Raleigh that handle grading, drainage and erosion, with clean lines that last for decades.",
    bullets: [
      "Block and poured concrete walls",
      "Built for drainage and erosion control",
      "Clean, finished look that adds usable yard",
      "Free on-site assessment",
    ],
    image: "/images/retaining_wall.png",
  },
  {
    slug: "paver-patios",
    name: "Paver Patios",
    navLabel: "Paver Patios",
    group: "core",
    blurb:
      "Custom paver patios and outdoor living spaces in Raleigh that add curb appeal and value, in a wide range of styles and colors.",
    intro:
      "A paver patio turns unused backyard space into the best room in the house. We design and install custom paver patios across Raleigh in a wide range of styles, colors and layouts, all built to add real value to your home.",
    bullets: [
      "Hundreds of paver styles and colors",
      "Patios, fire pit areas and seating walls",
      "Built on a solid, settle-proof base",
      "Free design and quote",
    ],
    image: "/images/back_patio_finished.png",
    beforeAfter: {
      before: "/images/back_patio_before.png",
      after: "/images/back_patio_after.png",
      label: "Backyard Patio",
    },
  },
  {
    slug: "concrete-patios",
    name: "Concrete Patios",
    navLabel: "Concrete Patios",
    group: "core",
    blurb:
      "Poured, stamped or broom-finished concrete patios in Raleigh, built flat, square and to last.",
    intro:
      "Concrete is the workhorse of backyard patios: affordable, tough and low-maintenance. We pour stamped, colored or broom-finished concrete patios across Raleigh, built flat, square and ready for years of cookouts.",
    bullets: [
      "Broom, smooth or stamped finishes",
      "Colors that match your home",
      "Flat, square and built to drain",
      "Free same-day quote",
    ],
    image: "/images/stamped_patio.png",
  },
  {
    slug: "walkways-sidewalks",
    name: "Walkways & Sidewalks",
    navLabel: "Walkways",
    group: "core",
    blurb:
      "Concrete and paver walkways, paths and sidewalks in Raleigh that are safe, level and tied into your landscape.",
    intro:
      "A clean walkway makes the whole property feel finished. We pour and lay concrete and paver walkways, paths and sidewalks across Raleigh that are safe, level and tied neatly into the rest of your landscape.",
    bullets: [
      "Concrete or paver paths",
      "Safe, level, slip-aware finishes",
      "Front walks, side paths and sidewalks",
      "Free quote",
    ],
    image: "/images/driveway_close_up_detailed_8k.png",
  },
  {
    slug: "stamped-decorative-concrete",
    name: "Stamped & Decorative Concrete",
    navLabel: "Stamped",
    group: "core",
    blurb:
      "Stamped, colored and textured concrete in Raleigh that mimics stone or brick for a fraction of the cost.",
    intro:
      "Want the look of natural stone or brick without the price tag? Stamped and decorative concrete gives you that high-end finish for a fraction of the cost. We stamp, color and texture concrete across Raleigh for patios, walkways and pool decks.",
    bullets: [
      "Stone, slate and brick patterns",
      "Custom colors and borders",
      "Sealed for long-lasting color",
      "Free quote",
    ],
    image: "/images/stampted_patio_2.png",
  },

  // ── Concrete (volume + satellite-quotable) ──
  {
    slug: "concrete-slabs-flatwork",
    name: "Concrete Slabs & Flatwork",
    navLabel: "Slabs & Flatwork",
    group: "concrete",
    blurb:
      "Garage pads, shed and AC pads, foundations and equipment slabs poured flat and to spec in Raleigh.",
    intro:
      "Need a solid slab? We pour garage pads, shed and AC pads, foundations and equipment slabs across Raleigh, flat, square and right to spec.",
    bullets: [
      "Garage and shed pads",
      "AC and equipment pads",
      "Foundations and footings",
      "Free same-day quote",
    ],
    image: "/images/workers_pouring_driveway_live_action.png",
  },
  {
    slug: "concrete-removal-replacement",
    name: "Concrete Removal & Replacement",
    navLabel: "Removal & Replacement",
    group: "concrete",
    blurb:
      "We demo old, cracked concrete and re-pour fresh, durable surfaces across Raleigh.",
    intro:
      "When concrete is too far gone to repair, we handle the whole job: demo the old slab, haul it off, and re-pour a fresh, durable surface. One crew, one price, anywhere in Raleigh.",
    bullets: [
      "Full demo and haul-off",
      "Fresh re-pour with proper base",
      "Driveways, patios and walkways",
      "Free quote",
    ],
    image: "/images/before_cracked_concrete_driveway.png",
    beforeAfter: {
      before: "/images/before_cracked_concrete_driveway.png",
      after: "/images/after_cracked_concrete_driveway.png",
      label: "Removal & Replacement",
    },
  },
  {
    slug: "concrete-repair-resurfacing",
    name: "Concrete Repair & Resurfacing",
    navLabel: "Repair & Resurfacing",
    group: "concrete",
    blurb:
      "Fix cracks, settling and worn concrete in Raleigh without a full tear-out.",
    intro:
      "Not every tired slab needs to be ripped out. We repair cracks, lift settling concrete and resurface worn surfaces across Raleigh, so your concrete looks new for a lot less than full replacement.",
    bullets: [
      "Crack and joint repair",
      "Resurfacing and overlays",
      "No full tear-out needed",
      "Free quote",
    ],
    image: "/images/after_cracked_concrete_driveway.png",
  },
  {
    slug: "pool-decks",
    name: "Pool Decks",
    navLabel: "Pool Decks",
    group: "concrete",
    blurb:
      "Stamped or finished concrete pool decking in Raleigh that stays cool, safe and slip-aware.",
    intro:
      "Your pool deserves a deck that looks great and stays safe underfoot. We pour stamped and finished concrete pool decks across Raleigh, with textures that hold up to sun, water and bare feet.",
    bullets: [
      "Stamped and textured finishes",
      "Slip-aware surfaces",
      "Cool-deck color options",
      "Free quote",
    ],
    image: "/images/stamped_patio.png",
  },
  {
    slug: "commercial-flatwork",
    name: "Commercial Flatwork",
    navLabel: "Commercial",
    group: "concrete",
    blurb:
      "Concrete flatwork for HOAs, property managers and small commercial properties in Raleigh and the Triangle.",
    intro:
      "We handle concrete flatwork for HOAs, property managers and small commercial properties across Raleigh and the Triangle, on schedule and on budget.",
    bullets: [
      "Sidewalks and walkways",
      "Parking and approach slabs",
      "ADA-aware ramps and pads",
      "Free quote",
    ],
    image: "/images/workers_pouring_driveway_live_action.png",
  },

  // ── Hardscaping (high-ticket) ──
  {
    slug: "paver-driveways",
    name: "Paver Driveways",
    navLabel: "Paver Driveways",
    group: "hardscaping",
    blurb:
      "Custom paver driveways in Raleigh that add serious curb appeal and stand up to daily use.",
    intro:
      "A paver driveway is a statement. We design and install custom paver driveways across Raleigh that turn heads and hold up to everyday use, with a base built to last.",
    bullets: [
      "Premium paver styles",
      "Settle-proof base",
      "Edge restraints for clean lines",
      "Free quote",
    ],
    image: "/images/after_driveway.png",
  },
  {
    slug: "paver-walkways-pathways",
    name: "Paver Walkways & Pathways",
    navLabel: "Paver Walkways",
    group: "hardscaping",
    blurb:
      "Paver walkways and garden pathways in Raleigh that connect your space and look great doing it.",
    intro:
      "Paver walkways tie your yard together and feel great underfoot. We lay paver paths and walkways across Raleigh on a solid base so they stay flat and even for years.",
    bullets: [
      "Front walks and garden paths",
      "Hundreds of paver options",
      "Flat, even, settle-proof",
      "Free quote",
    ],
    image: "/images/back_patio_finished.png",
  },
  {
    slug: "hardscape-paver-installation",
    name: "Hardscape & Paver Installation",
    navLabel: "Hardscaping",
    group: "hardscaping",
    blurb:
      "Full-service hardscape and paver installation in Raleigh: patios, walls, walkways and outdoor living.",
    intro:
      "From patios to walls to walkways, we handle full hardscape and paver installation across Raleigh. One crew to design and build the whole outdoor space.",
    bullets: [
      "Patios, walls and walkways",
      "Outdoor living layouts",
      "Premium materials",
      "Free design and quote",
    ],
    image: "/images/back_patio_finished.png",
  },
  {
    slug: "steps-stoops-landings",
    name: "Steps, Stoops & Landings",
    navLabel: "Steps & Stoops",
    group: "hardscaping",
    blurb:
      "Concrete and paver steps, stoops and landings in Raleigh, built safe, level and to code.",
    intro:
      "Steps and stoops take a beating and have to be just right. We build concrete and paver steps, stoops and landings across Raleigh that are safe, level and built to code.",
    bullets: [
      "Concrete or paver steps",
      "Front stoops and landings",
      "Safe, even risers",
      "Free quote",
    ],
    image: "/images/retaining_wall.png",
  },
  {
    slug: "seating-walls-fire-pits",
    name: "Seating Walls & Fire Pits",
    navLabel: "Fire Pits",
    group: "hardscaping",
    blurb:
      "Paver seating walls and fire pits in Raleigh that make your patio the place everyone gathers.",
    intro:
      "Want your backyard to be the spot? We build paver seating walls and fire pits across Raleigh that turn a patio into a gathering place.",
    bullets: [
      "Built-in seating walls",
      "Wood or gas fire pits",
      "Matched to your patio",
      "Free quote",
    ],
    image: "/images/back_patio_finished.png",
  },
  {
    slug: "landscape-curbing",
    name: "Landscape Curbing",
    navLabel: "Curbing",
    group: "hardscaping",
    blurb:
      "Concrete landscape curbing in Raleigh for clean, mower-friendly bed edges that last.",
    intro:
      "Concrete curbing gives your beds a crisp, finished edge that beats plastic edging and lasts for years. We install landscape curbing across Raleigh in a range of profiles and colors.",
    bullets: [
      "Continuous concrete edging",
      "Mower-friendly profiles",
      "Color and stamp options",
      "Free quote",
    ],
    image: "/images/driveway_close_up_detailed_8k.png",
  },
];

export const coreServices = services.filter((s) => s.group === "core");
export const concreteServices = services.filter((s) => s.group === "concrete");
export const hardscapingServices = services.filter((s) => s.group === "hardscaping");
export const serviceSlugs = services.map((s) => s.slug);
export function getService(slug: string): Service | undefined {
  return services.find((s) => s.slug === slug);
}

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
      "New driveways, patios and retaining walls in Wake Forest. Usually wrapped up fast, done right, and backed by our workmanship warranty.",
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
      "Clean, solid concrete and hardscaping across Durham: driveways, patios, walkways and retaining walls, all done right the first time.",
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
