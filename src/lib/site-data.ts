// ── Raleigh Concrete Group - central site data ──────────────────────────────
// Edit content here; the homepage, location pages, header and SEO all read from it.

export const businessName = "Raleigh Concrete Group";
export const phoneDisplay = "(919) 873-3919";
export const phoneHref = "tel:+19198733919";
export const textHref = "sms:+19198733919";

export type LocationKey =
  | "raleigh"
  | "cary"
  | "apex"
  | "wake-forest"
  | "durham"
  | "chapel-hill"
  | "morrisville"
  | "garner"
  | "holly-springs"
  | "knightdale";

export const locationKeys: LocationKey[] = [
  "raleigh",
  "cary",
  "apex",
  "wake-forest",
  "durham",
  "chapel-hill",
  "morrisville",
  "garner",
  "holly-springs",
  "knightdale",
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
  showcaseImage?: string;
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
    image: "/images/residential_driveway_raleigh_concrete.png",
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
    image: "/images/retaining-wall-brick.png",
    showcaseImage: "/images/retaining_wall.png",
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
    image: "/images/decorative_stampted_back_patio.png",
    showcaseImage: "/images/stamped_patio.png",
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
    image: "/images/walkway_concrete_front_of_house.png",
    showcaseImage: "/images/front_walkway+driveway.png",
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
    image: "/images/decorative_stamped_driveway.png",
    showcaseImage: "/images/stampted_patio_2.png",
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
    image: "/images/residential_driveway_raleigh_concrete_2.png",
    showcaseImage: "/images/workers_pouring_driveway_live_action.png",
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
    image: "/images/workers_pouring_driveway_live_action.png",
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
    showcaseImage: "/images/residential_driveway_raleigh_concrete.png",
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
    showcaseImage: "/images/decorative_stamped_back_porch.png",
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
    image: "/images/parkinglot-commercial-job.png",
    showcaseImage: "/images/commercial-entryway-clean.png",
  },
  {
    slug: "commercial-sidewalks-walkways",
    name: "Commercial Sidewalks & Walkways",
    navLabel: "Commercial Walkways",
    group: "concrete",
    blurb:
      "Commercial sidewalk and entry walkway concrete for offices, retail and medical properties across Raleigh.",
    intro:
      "We pour and replace commercial sidewalks and entry walkways for HOAs, office buildings, retail centers and medical properties across Raleigh. Our crews plan around your foot traffic and keep access clear while work is underway.",
    bullets: [
      "Entryways, sidewalk runs and path tie-ins",
      "Clean transitions and safe walking surfaces",
      "Work sequenced to reduce disruption",
      "Free site quote",
    ],
    image: "/images/commercial-sidewalk-entry-way-medical.png",
    showcaseImage: "/images/walkway_entryway-commercial.png",
  },
  {
    slug: "commercial-parking-approach-slabs",
    name: "Commercial Parking & Approach Slabs",
    navLabel: "Parking Slabs",
    group: "concrete",
    blurb:
      "Approach slabs and parking-area concrete for commercial properties and multi-unit communities.",
    intro:
      "From approach slabs to heavy-use parking areas, we install commercial concrete built for daily traffic and long-term durability. We coordinate staging, pours and cure windows to keep your property moving.",
    bullets: [
      "Approach slabs and high-traffic areas",
      "Built for durability and drainage",
      "Phased scheduling to protect access",
      "Free commercial estimate",
    ],
    image: "/images/parkinglot-commercial-job.png",
    showcaseImage: "/images/hoa_sidewalk_commercial.png",
  },
  {
    slug: "commercial-concrete-removal-replacement",
    name: "Commercial Concrete Removal & Replacement",
    navLabel: "Commercial Replacement",
    group: "concrete",
    blurb:
      "Demo and replacement of failed commercial concrete with proper base prep and clean site turnover.",
    intro:
      "When commercial concrete is cracked, settled or unsafe, we handle complete removal and replacement. Our team demos, hauls, re-forms and re-pours so your property is left clean and ready for daily use.",
    bullets: [
      "Full demo and haul-off",
      "Re-pour with proper prep and reinforcement",
      "Walkways, slabs, loading and access zones",
      "Clear scheduling and communication",
    ],
    image: "/images/loadnig_dock_commercial.png",
    showcaseImage: "/images/commercial-entryway-clean.png",
  },
  {
    slug: "commercial-concrete-repair-resurfacing",
    name: "Commercial Concrete Repair & Resurfacing",
    navLabel: "Commercial Repair",
    group: "concrete",
    blurb:
      "Commercial crack repair, patching and resurfacing to extend slab life without full replacement.",
    intro:
      "Not every commercial slab needs to be replaced. We repair cracks, patch damaged sections and resurface worn concrete so your property stays safe, presentable and functional.",
    bullets: [
      "Crack and joint stabilization",
      "Targeted patching and resurfacing",
      "Cost-effective life-extension options",
      "Fast commercial response",
    ],
    image: "/images/commercial-entryway-clean.png",
    showcaseImage: "/images/hoa_sidewalk_commercial.png",
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
    image: "/images/pavers_driveway.png",
    showcaseImage: "/images/pavers_front_porch-stairs.png",
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
    image: "/images/patio_pavers.png",
    showcaseImage: "/images/pavers_backyard_porchsetup.png",
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
    image: "/images/patio_pavers.png",
    showcaseImage: "/images/pavers_driveway.png",
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
    showcaseImage: "/images/pavers_front_porch-stairs.png",
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
    showcaseImage: "/images/pavers_backyard_porchsetup.png",
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
    showcaseImage: "/images/front_walkway+driveway.png",
  },
];

export const coreServices = services.filter((s) => s.group === "core");
export const concreteServices = services.filter((s) => s.group === "concrete");
export const hardscapingServices = services.filter((s) => s.group === "hardscaping");
export const serviceSlugs = services.map((s) => s.slug);
export function getService(slug: string): Service | undefined {
  return services.find((s) => s.slug === slug);
}

// ── Service FAQs ──
// High-intent Q&A for the money pages. Answers intentionally avoid price
// figures, warranty claims and licensing claims (per business policy) and lean
// on durability, process and free-quote messaging. Rendered on service pages
// and emitted as FAQPage structured data.
export type FaqItem = { q: string; a: string };

const universalServiceFaqs: FaqItem[] = [
  {
    q: "Do you offer free estimates in Raleigh?",
    a: "Yes. Every estimate is free, and we can usually get you a number the same day. For many projects we can scope it from satellite imagery and confirm details on a quick visit.",
  },
  {
    q: "What areas around Raleigh do you serve?",
    a: "We work throughout Raleigh and the surrounding Triangle, including Cary, Apex, Morrisville, Wake Forest, Garner, Holly Springs, Knightdale and Durham.",
  },
];

const serviceFaqMap: Record<string, FaqItem[]> = {
  "concrete-driveways": [
    {
      q: "How long does a new concrete driveway take to install?",
      a: "Most residential driveways take one to three days on site depending on size and whether we're tearing out an old slab. After the pour, plan on staying off it with foot traffic for about 24 hours and keeping vehicles off for roughly seven days while it cures.",
    },
    {
      q: "Should I repair or replace my concrete driveway?",
      a: "If you have isolated cracks or surface wear, resurfacing or repair is often enough. Once you see widespread cracking, sinking sections, or a failing base, a full tear-out and re-pour is the longer-lasting fix. We'll tell you honestly which one your driveway needs.",
    },
    {
      q: "How thick should a concrete driveway be?",
      a: "For standard residential vehicles we typically pour four inches over a properly compacted base, and we go thicker where heavier vehicles or trucks are parked. Good base prep matters as much as thickness for preventing early cracking.",
    },
  ],
  "concrete-patios": [
    {
      q: "How long does a concrete patio take to build?",
      a: "A typical backyard patio is usually poured within one to two days once the site is prepped. You can walk on it after about 24 hours, and it reaches full strength over the following weeks as it cures.",
    },
    {
      q: "What finishes can I get on a concrete patio?",
      a: "We offer broom, smooth-troweled, exposed-aggregate and stamped or decorative finishes. Stamped concrete can mimic stone, brick or pavers for a higher-end look at a lower install cost than natural stone.",
    },
  ],
  "paver-patios": [
    {
      q: "Are paver patios better than poured concrete?",
      a: "Pavers flex with the ground instead of cracking, individual units can be lifted and reset if needed, and there's a huge range of colors and patterns. Poured concrete is typically faster to install and lower maintenance. We'll walk you through the trade-offs for your yard.",
    },
    {
      q: "Do paver patios need a lot of maintenance?",
      a: "Not much. Occasional sweeping, the odd weed in the joints, and re-sanding the joints every few years keeps them looking sharp. We use a compacted base and edge restraints so they stay level over time.",
    },
  ],
  "walkways-sidewalks": [
    {
      q: "How long does it take to pour a walkway or sidewalk?",
      a: "Most residential walkways are finished in a day. Keep foot traffic off for about 24 hours after the pour while the surface sets.",
    },
    {
      q: "Can you match a new walkway to my existing concrete?",
      a: "In most cases yes. We match width, finish and joint spacing as closely as possible. Keep in mind brand-new concrete is lighter and lightens further as it cures, so a slight color difference from older concrete is normal at first.",
    },
  ],
  "stamped-decorative-concrete": [
    {
      q: "How long does stamped concrete last?",
      a: "With proper installation and a periodic re-seal every couple of years, stamped concrete holds up for decades. Sealing protects the color and pattern and helps it stand up to North Carolina sun and rain.",
    },
    {
      q: "Is stamped concrete cheaper than pavers or natural stone?",
      a: "Stamped concrete usually installs for less than natural stone or pavers while still giving you a custom stone, slate or brick look. It's a popular way to get a high-end finish on patios, walkways and pool decks on a tighter budget.",
    },
    {
      q: "Does stamped concrete get slippery?",
      a: "It can when wet, especially around pools. We can add a non-slip additive to the sealer on pool decks and walkways to improve traction.",
    },
  ],
  "retaining-walls": [
    {
      q: "Do I need a permit for a retaining wall?",
      a: "Taller walls and walls that hold back significant slopes often require a permit and, in some cases, engineering. We'll let you know what your project needs and build to handle the load and drainage behind it.",
    },
    {
      q: "How do retaining walls handle drainage?",
      a: "Proper drainage is what keeps a wall standing. We build in gravel backfill and drainage so water doesn't build up behind the wall, which is the most common reason walls fail or lean over time.",
    },
  ],
  "concrete-slabs-flatwork": [
    {
      q: "What are concrete slabs used for?",
      a: "Slabs work for sheds, garages, HVAC and generator pads, hot tubs, workshops and outdoor equipment. We prep the base and reinforce as needed so the slab carries the load without cracking or settling.",
    },
  ],
  "pool-decks": [
    {
      q: "What's the best surface for a pool deck?",
      a: "Stamped or broom-finished concrete is popular because it's durable and customizable, and we can add a non-slip additive to the sealer for safer footing around the water.",
    },
  ],
  "steps-stoops-landings": [
    {
      q: "Can you replace just my front steps or stoop?",
      a: "Yes. We replace and rebuild steps, stoops and landings on their own, and we can tie the finish into your existing walkway or porch so it looks like it was always there.",
    },
  ],
  "concrete-repair-resurfacing": [
    {
      q: "When is concrete repair worth it instead of replacement?",
      a: "If the slab is structurally sound with surface cracks, spalling or worn finish, resurfacing restores the look for less than a full replacement. Once the base has failed or sections are sinking, replacement is the better long-term call. We'll give you a straight answer after we look at it.",
    },
  ],
  "paver-driveways": [
    {
      q: "Can a paver driveway handle vehicle weight?",
      a: "Yes. With the right base depth, compaction and edge restraints, paver driveways carry everyday vehicle traffic and let you reset individual pavers later instead of patching a slab.",
    },
  ],
};

export function getServiceFaqs(slug: string): FaqItem[] {
  const specific = serviceFaqMap[slug] ?? [];
  return [...specific, ...universalServiceFaqs];
}

// Specific (non-universal) service FAQs, used when composing city+service pages
// so we don't repeat the site-wide "what areas do you serve" answer everywhere.
export function getServiceSpecificFaqs(slug: string): FaqItem[] {
  return serviceFaqMap[slug] ?? [];
}

// ── City + Service landing pages (/[city]/[service]) ──
// A page in this space exists if and only if it has hand-written copy in
// `cityServiceLocalContent` below. The pair list is DERIVED from that record,
// so there is no way to publish a city+service URL without first writing real
// content for it.
//
// This used to be the full cross product: 10 cities x 6 core services = 60
// pages, of which 8 had bespoke copy and 52 were generated from a sentence
// template with the city name and two neighborhoods swapped in. Google read
// those 52 exactly as what they were - it folded
// /chapel-hill/stamped-decorative-concrete into the Raleigh version
// ("Duplicate, Google chose different canonical") and left ~79 of the ~99
// sitemap URLs at "Discovered - currently not indexed", never spending the
// crawl. Every pair without an entry below now 301s to /services/<slug>
// instead; see next.config.ts.
export type CityServiceContent = {
  service: Service;
  city: string;
  locationKey: LocationKey;
  neighborhoods: string[];
  metaTitle: string;
  metaDescription: string;
  heading: string;
  paragraphs: string[];
  projectExample: string | null;
  faqs: FaqItem[];
};

// ── Hand-written city+service pages ──
// The single source of truth for which /[city]/[service] URLs exist. Keyed by
// `${locationKey}/${slug}`. Every entry carries a unique intro, a
// representative local project, city-specific FAQs and its own meta
// description - no shared template text, because shared template text is what
// got the old matrix de-indexed (see cityServicePairs below).
//
// Which pairs live here is driven by real demand, not a hunch:
//  - Raleigh's four are the highest-value pages on the site per docs/seo.md -
//    the driveway and stamped-concrete keyword clusters are P1 (near-zero
//    difficulty, high CPC) and are targeted directly at these URLs, not at
//    /services/<slug>. See RALEIGH_BRANDED_SERVICE_SLUGS in
//    src/app/services/[service]/page.tsx for how that page keeps its own
//    <title> from competing with these for the same phrase.
//  - Morrisville and Chapel Hill were the strongest non-Raleigh city surfaces
//    in Search Console despite having no bespoke copy at all; Durham produced
//    a click on a single impression. Cary and Apex kept their existing pages.
//
// Project examples are framed as "what a typical project here looks like" so
// nothing claims a specific past customer, and local rules are described in
// general terms with an explicit "we'll confirm what yours needs" - we are not
// the permitting authority and must not read as if we are.
type PriorityContent = {
  intro: string[];
  projectExample: string;
  faqs: FaqItem[];
  /** Overrides the generic `<service> in <city>, NC. <service blurb>` default. */
  metaDescription?: string;
};

const cityServiceLocalContent: Record<string, PriorityContent> = {
  "raleigh/concrete-driveways": {
    intro: [
      "Raleigh driveways take a beating, from daily traffic and brutal summer heat to the red clay soil that shifts under a poorly prepped slab. We pour and replace concrete driveways all over Raleigh, from the older homes around Five Points and Midtown to the newer builds out in Brier Creek and North Raleigh.",
      "A lot of the driveways we replace in established Raleigh neighborhoods are 30 to 50 years old: too thin, too narrow, and cracked from tree roots and decades of freeze-thaw. We tear them out, fix the base and drainage, and pour a properly reinforced four-inch slab (thicker where you park heavier vehicles) so the new driveway actually outlasts the old one.",
    ],
    projectExample:
      "A typical Raleigh driveway project for us is a full tear-out and re-pour on a mid-century home in Five Points or North Hills. We break out the old cracked slab, regrade and compact the base to fix the drainage that caused the cracking, set forms and rebar, then pour and finish with a broom or exposed-aggregate surface. Most are done in two to three days, weather permitting.",
    faqs: [
      {
        q: "How much does a concrete driveway cost in Raleigh?",
        a: "It depends on the size, whether we're removing an old slab, site access and the finish you choose. Rather than guess, we give you a free written quote, usually the same day, so you know the number before anything starts.",
      },
      {
        q: "Do I need a permit to replace a driveway in Raleigh?",
        a: "A like-for-like replacement usually doesn't, but widening the driveway or changing the apron where it meets the street can require approval from the City of Raleigh. We'll flag that before we begin.",
      },
      {
        q: "Will tree roots crack my new Raleigh driveway?",
        a: "Mature willow oaks and pines are everywhere in older Raleigh neighborhoods. We deal with roots during base prep and can add reinforcement or tweak the layout to lower the chance of future heaving.",
      },
    ],
  },
  "raleigh/concrete-patios": {
    intro: [
      "A concrete patio is the easiest way to turn an unused Raleigh backyard into real living space. We pour patios for homeowners from Midtown and Five Points to the newer neighborhoods around Brier Creek and North Raleigh, with broom, smooth, exposed-aggregate or stamped finishes to match the house.",
      "Raleigh's clay-heavy soil holds water, so drainage and base prep are everything with a patio. We grade the pad to pull water away from your foundation and pour a properly jointed slab that won't pond or crack through our hot summers and the occasional hard freeze.",
    ],
    projectExample:
      "A common Raleigh patio job is a 12x16 to 16x20 slab off the back of the house in a neighborhood like North Hills or Brier Creek, often with a stamped border or a step down into the yard. We handle layout, base, pour and finish in about one to two days once the site is ready.",
    faqs: [
      {
        q: "How big should my Raleigh patio be?",
        a: "For a table and chairs plus a small seating area, most Raleigh homeowners land around 16x20. We'll help you size it to your yard and how you actually plan to use the space before we pour.",
      },
      {
        q: "Should I choose concrete or pavers for my Raleigh patio?",
        a: "Concrete is faster to install, lower maintenance and easy to stamp for a custom look. Pavers flex with the ground and can be reset individually. We'll walk you through both for your yard and budget.",
      },
      {
        q: "Will my patio crack in Raleigh's weather?",
        a: "All concrete moves, which is why we cut control joints to direct any cracking and prep the base so the slab is supported evenly through Raleigh's heat and freeze-thaw swings.",
      },
    ],
  },
  "raleigh/stamped-decorative-concrete": {
    intro: [
      "Stamped concrete gives Raleigh homeowners the look of stone, brick or slate for a fraction of what those materials cost to install. We pour and stamp patios, walkways, porches and pool decks across Raleigh, from Five Points bungalows to new construction in Brier Creek.",
      "We work with a wide range of patterns and color combinations, and we seal every stamped surface so it stands up to Raleigh's UV-heavy summers. On walkways and pool decks we mix a non-slip additive into the sealer so the surface stays safe when it's wet.",
    ],
    projectExample:
      "A typical Raleigh stamped project is a back patio done in an ashlar-slate or seamless-stone pattern with a contrasting border band, then sealed, over a couple of days. We also do stamped front entries and walkways in older neighborhoods like Five Points and Midtown where homeowners want a high-end look that still suits the house.",
    faqs: [
      {
        q: "How long does stamped concrete last in Raleigh?",
        a: "With proper installation and a re-seal every couple of years, stamped concrete holds up for decades. Sealing is what protects the color and pattern against Raleigh's strong summer sun.",
      },
      {
        q: "Is stamped concrete cheaper than pavers in Raleigh?",
        a: "Usually, yes. Stamped concrete typically installs for less than pavers or natural stone while still giving you a custom stone or brick look on patios, walkways and pool decks.",
      },
      {
        q: "Does stamped concrete get slippery around a Raleigh pool?",
        a: "It can when wet, so for pool decks and walkways we add a non-slip additive to the sealer to improve traction.",
      },
    ],
  },
  "raleigh/retaining-walls": {
    intro: [
      "Plenty of Raleigh lots are anything but flat, and a well-built retaining wall is what keeps a sloped yard usable and your soil where it belongs. We build engineered concrete and segmental block retaining walls across Raleigh, from the rolling lots in North Raleigh to hillside properties near Five Points and Midtown.",
      "The walls that fail are the ones with bad drainage behind them, especially in Raleigh's clay soil that holds water and pushes hard against a wall. We build in gravel backfill, drainage and proper reinforcement, and we'll tell you up front if your wall height needs a permit or engineering.",
    ],
    projectExample:
      "A typical Raleigh wall project is a two-to-four-foot terraced block wall to level a backyard slope or stop erosion along a driveway in a neighborhood like North Hills. We excavate, compact a base, build the wall with proper batter and drainage, and backfill it so it holds for the long haul.",
    faqs: [
      {
        q: "Do I need a permit for a retaining wall in Raleigh?",
        a: "Shorter landscape walls often don't, but taller walls (commonly four feet and up) and walls holding back significant load typically require a permit and sometimes engineering. We'll let you know what yours needs.",
      },
      {
        q: "Why do retaining walls fail in Raleigh's clay soil?",
        a: "Almost always poor drainage. Clay holds water and pushes against the wall, so we build in gravel backfill and drainage pipe to relieve that pressure from the start.",
      },
      {
        q: "Should my Raleigh wall be block or poured concrete?",
        a: "Segmental block is versatile and great for terraced, landscaped looks; poured concrete suits taller structural walls. We'll recommend the right system for your slope and budget.",
      },
    ],
  },

  "cary/concrete-driveways": {
    intro: [
      "Cary's master-planned neighborhoods come with high standards, and a cracked or stained driveway stands out fast. We replace and pour concrete driveways across Cary, from Preston and MacGregor Downs to Amberly, Highcroft and West Cary, with clean finishes that fit the neighborhood.",
      "Many Cary communities have HOA guidelines on driveway materials and finishes, so we match what's approved and keep the work tidy from tear-out to final cleanup. Proper base prep on Cary's clay soil keeps the new slab from cracking the way the old one did.",
    ],
    projectExample:
      "A typical Cary driveway job is a full replacement in a community like Preston or Amberly: we remove the old slab, rebuild and compact the base, then pour a reinforced driveway with a broom or exposed-aggregate finish that meets HOA expectations. Most are completed in two to three days.",
    faqs: [
      {
        q: "Will you work with my Cary HOA's driveway requirements?",
        a: "Yes. A lot of Cary neighborhoods specify approved finishes and materials. We build to match what your HOA allows and keep the job site clean throughout.",
      },
      {
        q: "How long does a new driveway take in Cary?",
        a: "Most residential driveways are one to three days on site. Plan to stay off it on foot for about a day and keep vehicles off for roughly a week while it cures.",
      },
      {
        q: "Should I repair or replace my Cary driveway?",
        a: "Isolated cracks or surface wear can often be repaired or resurfaced. Widespread cracking, sinking sections or a failing base call for a full replacement. We'll give you a straight answer after we look.",
      },
    ],
  },
  "cary/concrete-patios": {
    intro: [
      "A concrete patio adds usable outdoor living space to a Cary home without the upkeep of wood or the cost of natural stone. We pour patios throughout Cary, from Preston and MacGregor Downs to Highcroft, Amberly and West Cary, in finishes from broom to stamped.",
      "We grade every Cary patio to drain away from the house, which matters with the area's clay soil, and we coordinate with HOA guidelines where they apply so your new patio is both approved and built to last.",
    ],
    projectExample:
      "A common Cary patio is a stamped or exposed-aggregate slab off the back of a two-story home in Amberly or Preston, sized for a table and a seating area, finished in a day or two once the base is prepped.",
    faqs: [
      {
        q: "Does my Cary HOA need to approve a patio?",
        a: "Often, yes, especially for anything visible or structural. We're used to building to HOA guidelines in Cary communities and can keep your patio within what's approved.",
      },
      {
        q: "Stamped or plain concrete patio in Cary?",
        a: "Plain broom-finish concrete is clean and economical; stamped concrete gives you a stone or slate look for a custom feel. Both hold up well when prepped and sealed correctly.",
      },
      {
        q: "How soon can I use my new Cary patio?",
        a: "You can usually walk on it after about 24 hours. It keeps gaining strength over the following weeks as it fully cures.",
      },
    ],
  },
  "apex/concrete-driveways": {
    intro: [
      "Apex keeps growing, and whether you're in an established part of town or a newer subdivision, a solid concrete driveway is one of the best upgrades for curb appeal and function. We pour and replace driveways across Apex, from Haddon Hall and Scotts Mill to Bella Casa, the Villages of Apex and downtown.",
      "We prep the base properly for Apex's clay soil and pour a reinforced slab built for daily traffic and North Carolina weather. Where an HOA has finish or material requirements, we build to match and keep the site clean throughout.",
    ],
    projectExample:
      "A typical Apex driveway project is a tear-out and re-pour on a home in Scotts Mill or Haddon Hall, where we fix the base and drainage that cracked the original, then finish with a broom or exposed-aggregate surface. Usually two to three days start to finish.",
    faqs: [
      {
        q: "How much does a driveway cost in Apex?",
        a: "Pricing comes down to size, removal of the old slab, access and finish. We give you a free, written quote, usually the same day, so there are no surprises.",
      },
      {
        q: "Do you handle Apex HOA driveway rules?",
        a: "Yes. Many Apex subdivisions have finish and material guidelines. We build to what's approved for your community.",
      },
      {
        q: "Can you replace just part of my Apex driveway?",
        a: "Often, yes. If the damage is contained to certain sections, a partial replacement at the control joints can save money versus a full tear-out. We'll tell you whether that makes sense for yours.",
      },
    ],
  },
  "apex/concrete-patios": {
    intro: [
      "A concrete patio turns an Apex backyard into space you'll actually use, for less than pavers or natural stone and with almost no upkeep. We pour patios across Apex, from the Villages of Apex and downtown to Haddon Hall, Bella Casa and Scotts Mill.",
      "Apex's clay soil holds water, so we grade each patio to drain away from your foundation and joint the slab to control cracking through hot summers and the occasional hard freeze. Broom, exposed-aggregate and stamped finishes are all on the table.",
    ],
    projectExample:
      "A typical Apex patio is a 12x16 to 16x20 slab off the back of the house in a neighborhood like Bella Casa or Scotts Mill, sometimes with a stamped border, finished in a day or two once the base is set.",
    faqs: [
      {
        q: "What's the best patio surface for an Apex backyard?",
        a: "Concrete is hard to beat on value and upkeep, and it can be stamped for a high-end look. We'll match the finish to your home and how you want to use the space.",
      },
      {
        q: "Will an Apex patio crack over time?",
        a: "We cut control joints to direct any natural cracking and prep the base so the slab is evenly supported through Apex's seasonal temperature swings.",
      },
      {
        q: "Do I need HOA approval for a patio in Apex?",
        a: "Frequently, yes. We're comfortable working within Apex HOA guidelines so your patio is approved and built to last.",
      },
    ],
  },

  // ── Morrisville ──
  // The strongest city surface in Search Console by a wide margin, and it was
  // running on template copy the whole time. Retaining wall queries lead by
  // roughly 3x, followed by exposed aggregate, driveways and paver patios.
  "morrisville/retaining-walls": {
    metaDescription:
      "Retaining wall contractor in Morrisville, NC. Engineered block and poured walls with real drainage behind them, built for the grade changes around Kitts Creek, Carpenter Village and Breckenridge. Free quotes.",
    intro: [
      "Morrisville sits on some genuinely awkward ground. Between the grade changes running toward Crabtree Creek and the way many of the newer subdivisions were cut and filled to fit more homes on the parcel, a lot of properties here ended up with a slope somebody has to hold back. We build engineered block and poured concrete retaining walls throughout Morrisville, from Kitts Creek and Carpenter Village to Breckenridge, Savannah and the homes around Town Hall Commons.",
      "Most of the failing walls we're called out to look at in Morrisville are not failing because the block was wrong. They're failing because nothing was done about water. Wake County clay holds water, that water has to go somewhere, and when there's no gravel and no drain pipe behind a wall it pushes until the wall leans, bulges or separates at the joints. We build the drainage first and the wall second, and we'll tell you honestly before we start whether your height and load need a permit or a stamped engineering design.",
    ],
    projectExample:
      "A typical Morrisville wall for us is a two-to-four-foot segmental block wall reclaiming a sloped back corner in a neighborhood like Kitts Creek or Carpenter Village, often terraced into two shorter runs rather than one tall one because it looks better and puts less load on any single course. We excavate, compact a proper leveling pad, set the base course dead level, build up with the right batter, install gravel backfill and a perforated drain line, then cap it and backfill. Most run three to five days depending on length and access.",
    faqs: [
      {
        q: "Do I need a permit for a retaining wall in Morrisville?",
        a: "Shorter landscape walls usually don't. Taller walls and any wall holding back a surcharge load, like a driveway or a slope above it, typically do, and can need an engineer's design. Thresholds vary by height and situation, so we look at your specific wall and tell you what it needs before we quote it rather than after.",
      },
      {
        q: "Why do so many Morrisville retaining walls lean or bulge?",
        a: "Almost always drainage. The clay soil here holds water, and a wall with no gravel backfill and no drain pipe behind it takes the full hydrostatic pressure of every heavy rain. That's what pushes a wall out of plumb over a few seasons. We build the drainage in from the start, which is the difference between a wall that lasts and one you rebuild.",
      },
      {
        q: "Block or poured concrete for a Morrisville wall?",
        a: "Segmental block suits terraced and landscaped walls, gives you more finish options, and is the right answer for most residential yards here. Poured concrete makes sense for taller structural walls and tight-tolerance situations. We'll recommend based on your slope, height and what's above the wall, not on what's easiest for us.",
      },
      {
        q: "Can you build a seating wall or landscape wall instead?",
        a: "Yes. Not every grade problem needs a full structural retaining wall, and not every wall is about grade at all. We build low seating walls and landscape walls too, and if what you actually want is a defined edge rather than serious earth retention, we'll say so.",
      },
    ],
  },
  "morrisville/stamped-decorative-concrete": {
    metaDescription:
      "Stamped and exposed aggregate concrete in Morrisville, NC. Patios, walkways, pool decks and front entries in stone, slate and brick patterns, sealed for NC sun. Free same-day quotes.",
    intro: [
      "Stamped and exposed aggregate concrete gives a Morrisville home the texture of stone, slate or brick without paying stone prices to install it. We pour, stamp and finish decorative concrete across Morrisville, on back patios in Breckenridge and Savannah, front entries and walkways in Carpenter Village, and pool decks throughout the newer sections of town.",
      "Exposed aggregate in particular comes up a lot around here, and it's a good fit for Morrisville: it hides dirt better than a smooth finish, it grips underfoot when it's wet, and it doesn't show the surface scuffing that a broom finish picks up over time. Whichever finish you go with, we seal it, and on pool decks and walkways we work a non-slip additive into the sealer so traction doesn't drop off the moment it rains.",
    ],
    projectExample:
      "A typical Morrisville decorative job is a back patio in an ashlar slate or seamless stone pattern with a contrasting border band, or an exposed aggregate driveway apron and front walkway tying into an existing entry. We pour, stamp or wash and expose the surface, cure it, then come back to seal. Figure two to three days on site plus the return trip for sealer.",
    faqs: [
      {
        q: "How much does exposed aggregate cost in Morrisville?",
        a: "It runs above a plain broom finish and below natural stone or pavers, and the real drivers are square footage, whether we're removing existing concrete, and site access. We put a written number in front of you, usually the same day, so you're comparing an actual price rather than a range off a website.",
      },
      {
        q: "How often does stamped concrete need resealing here?",
        a: "Plan on every couple of years in Morrisville. The sealer is what carries the color and protects the pattern, and North Carolina summer sun is hard on it. Skipping it doesn't fail the concrete, but the color will flatten out noticeably faster.",
      },
      {
        q: "Is stamped concrete slippery around a pool?",
        a: "It can be when wet, which is why we add a non-slip additive to the sealer on any pool deck or walkway. Exposed aggregate is naturally better on traction if that's your main concern, and we're happy to steer you that way.",
      },
    ],
  },
  "morrisville/concrete-driveways": {
    metaDescription:
      "Concrete driveway installation and replacement in Morrisville, NC. Proper base prep for Wake County clay, HOA-friendly finishes, and free written quotes usually the same day.",
    intro: [
      "A driveway is the largest single piece of concrete on most Morrisville properties and the first thing anyone sees. We pour and replace concrete driveways across Morrisville, from the established streets near Town Hall Commons to Breckenridge, Savannah, Kitts Creek and Carpenter Village.",
      "Morrisville's housing stock skews newer than most of the Triangle, which changes what we usually find. Instead of a fifty-year-old slab that has simply run out of life, we're more often looking at a fifteen-to-twenty-year-old driveway that was poured thin, on a base that was never properly compacted, and is now cracking along predictable lines. Fixing that means fixing the base, not just replacing the concrete on top of it, which is why we dig into what caused the failure before we quote the replacement.",
    ],
    projectExample:
      "A typical Morrisville driveway job is a full tear-out and re-pour on a two-car drive in a subdivision like Breckenridge or Kitts Creek. We break out and haul the old slab, regrade and recompact the base to correct whatever drainage caused the cracking, set forms and reinforcement, then pour and finish, usually broom or exposed aggregate to sit right with the neighborhood. Two to three days on site, weather permitting.",
    faqs: [
      {
        q: "Will you work within my Morrisville HOA's requirements?",
        a: "Yes, and in Morrisville that comes up on most jobs. A lot of the town is covered by HOAs with specific rules about driveway finishes, colors and whether you can widen. We build to what's approved for your community and keep the site clean while we're there.",
      },
      {
        q: "Can I widen my driveway in Morrisville?",
        a: "Often yes, but widening is the change most likely to need approval, both from your HOA and from the town if it affects the apron where the driveway meets the street. Impervious surface limits can also apply on some lots. We flag all of that before anything gets poured.",
      },
      {
        q: "How long before I can park on a new Morrisville driveway?",
        a: "Stay off it on foot for about a day, and keep vehicles off for roughly a week. It keeps gaining strength for weeks after that, but a week is the point where normal use stops being a risk.",
      },
    ],
  },
  "morrisville/paver-patios": {
    metaDescription:
      "Paver patio installation in Morrisville, NC. Compacted base, edge restraints and polymeric sand so the patio stays level. Serving Kitts Creek, Carpenter Village, Breckenridge and Savannah.",
    intro: [
      "Pavers are a strong choice in Morrisville, and the reason is the ground. Clay soil moves seasonally, and where a poured slab responds to that movement by cracking, a paver patio flexes with it and stays intact. We design and install paver patios throughout Morrisville, in Kitts Creek, Carpenter Village, Breckenridge, Savannah and the neighborhoods around Town Hall Commons.",
      "The tradeoff is that pavers are far less forgiving of a bad base. A paver patio is only as good as the compacted aggregate underneath it and the edge restraint holding it together, and skipping either is how you end up with a rippling, spreading patio in three years. We build the base to depth, compact it in lifts, restrain the perimeter properly and lock the joints with polymeric sand.",
    ],
    projectExample:
      "A typical Morrisville paver patio is a 250 to 400 square foot space off the back of the house, often stepping down from an existing deck, with a soldier-course border and a contrasting banding detail. Excavation and base prep is the bulk of the work; the laying itself goes quickly. Most are three to four days start to finish.",
    faqs: [
      {
        q: "Pavers or poured concrete for a Morrisville backyard?",
        a: "Pavers flex with the clay instead of cracking, give you far more color and pattern range, and let you lift and reset individual units later. Poured concrete installs faster and costs less up front. If you want the honest version: for pure value poured concrete wins, for looks and long-term repairability pavers do.",
      },
      {
        q: "Do paver patios sink or shift over time in Morrisville?",
        a: "A properly built one doesn't meaningfully move. The ones that do were built on too little base, on base that wasn't compacted in lifts, or without edge restraints. That's where the cost is in a paver patio, and it's not the part to save money on.",
      },
      {
        q: "Does my HOA need to approve a paver patio in Morrisville?",
        a: "Usually yes for anything visible from the street or common area, and sometimes for backyard work too. We're used to building within Morrisville HOA guidelines and can help with what your board needs to see.",
      },
    ],
  },
  "morrisville/concrete-patios": {
    metaDescription:
      "Concrete patio installation in Morrisville, NC. Broom, smooth, exposed aggregate and stamped finishes, graded to drain away from the house. Free same-day quotes.",
    intro: [
      "A poured concrete patio is the most cost-effective way to turn unused Morrisville backyard into space you'll actually sit in. We pour patios across Morrisville, in Breckenridge, Savannah, Kitts Creek and Carpenter Village, in broom, smooth, exposed aggregate and stamped finishes.",
      "Drainage is the thing to get right on a Morrisville patio. Many of the newer lots here are tight, with the house sitting relatively high and the yard falling away, and a patio poured flat against that grade will either pond or push water back toward your foundation. We set the pad with deliberate fall away from the house and cut control joints on a proper spacing so the slab cracks where we tell it to instead of where it wants to.",
    ],
    projectExample:
      "A common Morrisville patio is a 12x16 to 16x20 slab off the back door, sometimes with a stamped or exposed aggregate border to lift it above a plain pour, and a step down into the yard where the grade calls for it. Once the site is prepped it's typically a one-to-two-day pour and finish.",
    faqs: [
      {
        q: "How big should a Morrisville patio be?",
        a: "For a table with chairs plus a separate seating area, most people land around 16x20. Smaller than about 12x12 and furniture starts fighting for room. We'd rather size it to how you actually plan to use it than sell you square footage you won't sit on.",
      },
      {
        q: "Will a concrete patio crack in Morrisville?",
        a: "All concrete moves and all concrete eventually cracks somewhere. The job is controlling where. We cut control joints at the right spacing and prep the base so the slab is evenly supported, which is what turns cracking into a hairline in a joint rather than a break across the middle of your patio.",
      },
      {
        q: "Can you match a new patio to my existing concrete?",
        a: "We can get close on finish and joint spacing, but be realistic about color: new concrete will not match cured concrete, and it takes a season or more to weather in. If an exact match matters to you, we'll usually suggest a deliberate contrast instead.",
      },
    ],
  },

  // ── Chapel Hill ──
  // Second strongest city surface. Driveway queries dominate, and a notable
  // share of them ask for asphalt/blacktop - which we do not install. The
  // driveway page answers that head-on rather than letting the visitor bounce.
  "chapel-hill/concrete-driveways": {
    metaDescription:
      "Concrete driveway installation and replacement in Chapel Hill, NC. Built for hilly lots, mature tree roots and Chapel Hill's stormwater rules. Free written quotes, usually same day.",
    intro: [
      "Chapel Hill driveways are harder than most in the Triangle, and it comes down to terrain and trees. The lots here are hilly, a lot of the older housing stock near town sits under mature hardwoods, and a driveway that runs up a grade under fifty-year-old oaks has to deal with both root heave and water moving down the slope. We pour and replace concrete driveways across Chapel Hill, from Glen Lennox and the older streets near downtown to Southern Village, Meadowmont, Chapel Hill North and Briar Chapel.",
      "Chapel Hill also regulates land disturbance and impervious surface more tightly than most towns around here, and there are tree protection rules that can affect what you're allowed to do near a mature trunk. None of that stops a driveway replacement, but it does mean widening or changing your footprint is worth checking before you plan around it. We'll look at what applies to your lot and tell you straight rather than pouring first and finding out after.",
    ],
    projectExample:
      "A typical Chapel Hill driveway job is a sloped tear-out and re-pour on an older home near Glen Lennox or off Franklin, where the original slab has heaved over roots and lost its drainage. We remove the old concrete, deal with the roots during base prep, correct the grade so water leaves the driveway instead of sheeting toward the garage, then pour a reinforced slab with a broom finish. Two to three days, with access and slope driving the schedule more than square footage does.",
    faqs: [
      {
        q: "Do you install asphalt or blacktop driveways in Chapel Hill?",
        a: "No. We're a concrete and paver contractor, so if asphalt is specifically what you want we're not your company and we'd rather tell you that now. If you're weighing the two, concrete costs more up front and lasts substantially longer, handles Chapel Hill's summer heat without softening, and doesn't need resealing every few years. Happy to talk through the comparison honestly.",
      },
      {
        q: "Will tree roots crack a new Chapel Hill driveway?",
        a: "It's the single most common cause of failure we see here. Mature oaks and poplars are everywhere in the older neighborhoods, and roots will lift a slab that was poured over them. We address roots during base prep, add reinforcement, and where the tree makes a conventional pour a bad bet we'll say so and talk about routing or materials that tolerate movement better.",
      },
      {
        q: "Do I need approval to replace a driveway in Chapel Hill?",
        a: "A like-for-like replacement usually doesn't. Widening, changing where the driveway meets the street, or adding impervious surface is where Chapel Hill's stormwater and land disturbance rules can come into play, and tree protection can apply near mature trunks. We check what your lot triggers before we quote it.",
      },
    ],
  },
  "chapel-hill/paver-patios": {
    metaDescription:
      "Paver patio installation in Chapel Hill, NC. Built on a compacted base with proper edge restraint for sloped, wooded lots in Southern Village, Meadowmont, Briar Chapel and Glen Lennox.",
    intro: [
      "Paver patios suit Chapel Hill particularly well. The lots here slope, they're often wooded, and roots keep working long after a patio goes in. A paver surface handles all three better than a monolithic slab does: it can be built in steps and terraces to follow a grade, and if a root does lift a section years down the line you pull those pavers, fix the base and reset them, rather than looking at a cracked slab you can't repair invisibly.",
      "We install paver patios throughout Chapel Hill, in Southern Village, Meadowmont, Chapel Hill North, Glen Lennox and Briar Chapel. On sloped sites the base work and the edge restraint carry the whole job, so that's where the effort goes: excavation to depth, aggregate compacted in lifts, a properly restrained perimeter, and polymeric sand locking the joints.",
    ],
    projectExample:
      "A typical Chapel Hill paver patio is a terraced installation on a sloped back lot in a neighborhood like Southern Village or Briar Chapel, often two levels connected by a few steps, with a low seating wall doubling as the retaining edge for the upper level. These take longer than a flat install, usually four to six days, because the grading and the wall work happen before a single paver gets laid.",
    faqs: [
      {
        q: "Can you build a paver patio on a sloped Chapel Hill lot?",
        a: "Yes, and it's most of what we do here. The usual answer is terracing: two or more level areas at different heights connected by steps, with a retaining or seating wall holding the grade between them. It works better than trying to force one large flat pad into a hillside, and it looks better too.",
      },
      {
        q: "How do pavers hold up under Chapel Hill's tree cover?",
        a: "Better than poured concrete, for two reasons. Roots lift individual pavers rather than cracking a slab, and those pavers can be lifted and reset. Shade and leaf litter do mean more organic buildup, so expect to clean them more often than you would a patio in full sun.",
      },
      {
        q: "Do pavers need sealing in Chapel Hill?",
        a: "Not structurally. Sealing deepens the color and makes stains easier to clean off, which matters more under heavy tree cover where you're dealing with leaf tannins and sap. It's a preference call, not a requirement, and we'll tell you what we'd do on your specific installation.",
      },
    ],
  },
  "chapel-hill/concrete-patios": {
    metaDescription:
      "Concrete patio installation in Chapel Hill, NC. Graded to drain on sloped lots, jointed to control cracking, in broom, exposed aggregate and stamped finishes. Free quotes.",
    intro: [
      "A poured concrete patio is the most economical way to add real outdoor living space to a Chapel Hill home, and on the flatter lots around Meadowmont, Chapel Hill North and parts of Southern Village it's usually the right call. We pour patios across Chapel Hill in broom, smooth, exposed aggregate and stamped finishes.",
      "On Chapel Hill's steeper, more wooded lots we'll sometimes tell you a poured patio isn't the best answer. Where a slab has to sit against a real grade change, or where it would have to be poured over significant roots, pavers or a terraced approach will hold up better and we'd rather say that at the quote than replace a cracked slab in five years. Where a poured patio does make sense, we grade it to drain away from the house and joint it properly so any cracking lands where we put it.",
    ],
    projectExample:
      "A typical Chapel Hill concrete patio is a 14x18 to 16x22 slab off the back of a home in Meadowmont or Chapel Hill North, poured with deliberate fall away from the foundation, finished broom or exposed aggregate, and stepped down into the yard where the grade needs it. One to two days to pour and finish once the site is prepped.",
    faqs: [
      {
        q: "Concrete or pavers for a Chapel Hill patio?",
        a: "Flat lot with no significant root pressure, concrete is the better value and installs faster. Sloped, heavily wooded, or where you want to terrace, pavers are worth the extra cost because they tolerate movement and can be repaired section by section. We'll look at your yard and give you a real recommendation, not just quote whatever you asked for.",
      },
      {
        q: "How do you keep a patio from draining toward my house?",
        a: "We set fall into the pad deliberately, typically around a quarter inch per foot away from the foundation, and confirm where the water goes once it leaves the slab. On Chapel Hill's sloped lots that second part matters as much as the first, because moving water off the patio into a spot that already floods hasn't solved anything.",
      },
      {
        q: "Does Chapel Hill limit how much patio I can add?",
        a: "It can. Chapel Hill pays closer attention to impervious surface and land disturbance than most towns nearby, and some lots and neighborhoods have their own limits on top of that. It rarely blocks a normal residential patio, but it's worth confirming before you design around a specific size, and we check it as part of the quote.",
      },
    ],
  },

  // ── Durham ──
  // Small but real: one click on one impression for "durham concrete company",
  // and steady driveway-installation demand.
  "durham/concrete-driveways": {
    metaDescription:
      "Concrete driveway installation and replacement in Durham, NC. Historic-district-aware work in Trinity Park and Hope Valley, plus newer subdivisions near Southpoint. Free quotes.",
    intro: [
      "Durham driveways split into two very different jobs, and which one you have changes everything about the quote. In Trinity Park, Brightleaf and Hope Valley we're usually replacing genuinely old concrete, sometimes narrow, sometimes poured before anyone was thinking about a modern base, often with mature trees involved and occasionally inside a local historic district where what you install is subject to review. Out toward Southpoint and Woodcroft it's a more straightforward subdivision replacement.",
      "We do both. On the older side of Durham that means checking what applies to your property before we design anything, because a historic district can have a say in materials and finish, and a driveway that's fine two streets over may not be approved on yours. On the newer side it means the usual discipline: find out what failed in the base, fix that, then pour a properly reinforced slab on top of it.",
    ],
    projectExample:
      "A typical Durham driveway job in the older neighborhoods is a narrow, cracked, root-heaved drive alongside a 1920s or 1930s house, where the work is as much about roots and grade as it is about concrete. We remove the old slab, deal with the root situation during base prep, correct drainage, then pour and finish. Newer Durham subdivisions near Southpoint are a more standard two-to-three-day tear-out and re-pour.",
    faqs: [
      {
        q: "Can you replace a driveway in a Durham historic district?",
        a: "Yes, but expect the process to include approval. Durham has local historic districts where exterior changes visible from the street can require review, and that can affect finish and materials. We'll help you understand what your property is subject to before we design the replacement, so you're not redoing paperwork after the fact.",
      },
      {
        q: "My Durham driveway is too narrow. Can you widen it?",
        a: "Usually. It's very common on older Durham homes built when one car was the assumption. Widening is more likely to need approval than a like-for-like replacement, especially where it changes the apron at the street or where you're in a historic district, and we sort that out up front.",
      },
      {
        q: "How much does a concrete driveway cost in Durham?",
        a: "Size, removal of the old slab, site access and finish are what move the number, and on older Durham lots access is a bigger factor than people expect. We give you a free written quote, usually the same day, rather than a range you can't plan around.",
      },
    ],
  },
  "durham/concrete-patios": {
    metaDescription:
      "Concrete patio installation in Durham, NC. Broom, exposed aggregate and stamped finishes, graded to drain, for homes in Hope Valley, Woodcroft, Trinity Park and near Southpoint.",
    intro: [
      "A concrete patio adds usable outdoor space to a Durham home for meaningfully less than pavers or natural stone, with close to no upkeep once it's sealed. We pour patios across Durham, from Hope Valley and Trinity Park to Woodcroft and the newer neighborhoods around Southpoint, in broom, smooth, exposed aggregate and stamped finishes.",
      "The older parts of Durham come with mature tree cover, which affects a patio in two ways worth planning for: roots under the pad, and shade that keeps the surface damp longer after rain. We work around root systems during base prep rather than pouring over them, and we'll steer you toward a finish with some texture in the shadier spots, because a smooth trowel finish under heavy canopy stays slick longer than most people expect.",
    ],
    projectExample:
      "A typical Durham patio is a 12x16 to 16x20 slab off the back of the house in a neighborhood like Woodcroft or Hope Valley, poured with fall away from the foundation, jointed on proper spacing, and finished broom or exposed aggregate. One to two days on site once the base is ready.",
    faqs: [
      {
        q: "Can you pour a patio around mature trees in Durham?",
        a: "Often, with adjustments. We'd rather shift or shape the patio to give a significant root system room than pour over it and watch the slab lift in a few years. If the tree makes a poured slab a bad bet in that spot, we'll tell you and talk about pavers, which tolerate root movement far better.",
      },
      {
        q: "What patio finish holds up best in shady Durham yards?",
        a: "Something with texture. Broom finish or exposed aggregate keeps its grip when the surface stays damp, which under heavy Durham tree cover is a lot of the time. A smooth trowel finish looks sharp but gets slick in the shade, so we generally don't recommend it for a shaded back patio.",
      },
      {
        q: "How soon can I use a new Durham patio?",
        a: "Walk on it after about 24 hours. Furniture can go back within a few days. It keeps curing and gaining strength for weeks after that, but you're not waiting on that to start using it.",
      },
    ],
  },
};

// The published city+service URL space, derived from the hand-written content
// above. There is deliberately no template fallback: if a pair has no entry in
// `cityServiceLocalContent` it has no page, and next.config.ts 301s it to the
// service page instead.
export const cityServicePairs: { location: LocationKey; service: string }[] =
  Object.keys(cityServiceLocalContent).map((key) => {
    const [location, service] = key.split("/");
    return { location: location as LocationKey, service };
  });

const cityServicePairKeys = new Set(Object.keys(cityServiceLocalContent));

export function isCityServicePair(location: string, service: string): boolean {
  return cityServicePairKeys.has(`${location}/${service}`);
}

/**
 * Which hand-written service pages exist for a city. Used by the cross-link
 * block so a city page never links at a sibling URL that now redirects away.
 */
export function cityServicesFor(location: LocationKey): string[] {
  return cityServicePairs.filter((p) => p.location === location).map((p) => p.service);
}

export function getCityServiceContent(
  locationKey: LocationKey,
  slug: string,
): CityServiceContent | null {
  const service = getService(slug);
  const local = cityServiceLocalContent[`${locationKey}/${slug}`];
  if (!service || !local) return null;

  const location = locations[locationKey];
  const city = location.city;

  return {
    service,
    city,
    locationKey,
    neighborhoods: location.neighborhoods,
    metaTitle: `${service.name} in ${city}, NC`,
    metaDescription:
      local.metaDescription ??
      `${service.name} in ${city}, NC. ${service.blurb} Free same-day quotes from a local Triangle crew.`,
    heading: `${service.name} in ${city}, NC`,
    paragraphs: local.intro,
    projectExample: local.projectExample,
    faqs: local.faqs,
  };
}

// Localized FAQs for city landing pages. The city name is woven into each
// answer so every location page carries unique FAQ content (no boilerplate
// duplication that could read as doorway pages).
export function getLocationFaqs(city: string): FaqItem[] {
  return [
    {
      q: `Do you offer free concrete estimates in ${city}?`,
      a: `Yes. Estimates in ${city} are always free and usually same-day. For driveways and slabs we can often quote from satellite imagery and confirm the details on a short visit.`,
    },
    {
      q: `How soon can you start a concrete project in ${city}?`,
      a: `Scheduling in ${city} depends on the season and our current workload, but we move quickly on quotes and will give you a realistic start window up front instead of stringing you along.`,
    },
    {
      q: `What concrete and hardscaping services do you offer in ${city}?`,
      a: `We handle driveways, patios, walkways, sidewalks, slabs, steps, retaining walls, stamped and decorative concrete, and paver work for homes and businesses throughout ${city}.`,
    },
    {
      q: `Is your concrete work built for ${city}'s weather?`,
      a: `Yes. We prep a proper compacted base, reinforce where it's needed, and finish and cure the concrete so it stands up to North Carolina's heat, rain and freeze-thaw cycles in ${city}.`,
    },
  ];
}

// Simple, customer-friendly options for the quote-request dropdown.
export const quoteServiceOptions = [
  "Driveway",
  "Patio",
  "Walkway/Sidewalk",
  "Pad/Slab",
  "Front/Back Porch",
  "Steps",
  "Pool Deck",
  "Retaining Wall",
  "Commercial",
  "Other",
];

// Photo of our team walking a homeowner through their quote - used to build trust.
export const trustImage = "/images/servicing-to-client-image.png";
export const clipboardImage = "/images/contractor_holding_pen+paper.png";

// ── Header dropdowns: residential vs commercial ──
export type NavLink = { label: string; slug: string };

export const residentialNav: NavLink[] = [
  { label: "Concrete Driveways", slug: "concrete-driveways" },
  { label: "Concrete Patios", slug: "concrete-patios" },
  { label: "Paver Patios", slug: "paver-patios" },
  { label: "Walkways & Sidewalks", slug: "walkways-sidewalks" },
  { label: "Stamped & Decorative", slug: "stamped-decorative-concrete" },
  { label: "Pool Decks", slug: "pool-decks" },
  { label: "Retaining Walls", slug: "retaining-walls" },
  { label: "Steps, Stoops & Landings", slug: "steps-stoops-landings" },
  { label: "Slabs & Flatwork", slug: "concrete-slabs-flatwork" },
  { label: "Repair & Resurfacing", slug: "concrete-repair-resurfacing" },
];

export const commercialNav: NavLink[] = [
  { label: "Commercial Flatwork", slug: "commercial-flatwork" },
  { label: "Sidewalks & Walkways", slug: "commercial-sidewalks-walkways" },
  { label: "Parking & Approach Slabs", slug: "commercial-parking-approach-slabs" },
  { label: "Removal & Replacement", slug: "commercial-concrete-removal-replacement" },
  { label: "Repair & Resurfacing", slug: "commercial-concrete-repair-resurfacing" },
];
export const commercialServiceSlugs = new Set(commercialNav.map((item) => item.slug));

// ── "What to Expect" 3-step process ──
export type ProcessStep = { title: string; body: string };
export const processSteps: ProcessStep[] = [
  {
    title: "Request Your Free Quote",
    body: "Call, text, or fill out our quick form and tell us about your project. It takes about a minute, and there's no obligation.",
  },
  {
    title: "Talk With a Concrete Pro",
    body: "We go over your goals, your budget, and the best options for your space with straight answers, no pressure, and no jargon.",
  },
  {
    title: "Approve & Get Scheduled",
    body: "Once you approve your written quote, we lock in a date and handle the entire job from prep to final cleanup.",
  },
];

// ── Stat bar ("What makes us different") ──
export type Stat = { value: string; label: string };
export const homeStats: Stat[] = [
  { value: "5.0★", label: "Rated on Google" },
  { value: "20+ Yrs", label: "Combined Crew Experience" },
  { value: "Local", label: "Raleigh-Based Team" },
  { value: "Same-Day", label: "Free Quotes" },
];

// ── About / welcome copy ──
export const aboutParagraphs: string[] = [
  "Finding a concrete contractor you can actually count on in Raleigh shouldn't be this hard. At Raleigh Concrete Group, our crews have poured and built countless driveways, patios, walkways and retaining walls across the Triangle, and we treat every job like it's at our own home.",
  "Whether you need a brand-new driveway, a backyard patio you'll actually use, or a commercial slab done on schedule, we start with a free, detailed quote so you know the price before we ever break ground. Our crews are experienced, respectful on site, and familiar with local codes across Raleigh and the surrounding towns.",
];

export const valueProps = [
  "We Show Up On Time",
  "Clear, Honest Pricing",
  "Clean Job Sites Every Time",
];

export type GalleryImage = { src: string; alt: string };

// "Recent work" gallery shown in the auto-scrolling carousels and the /gallery
// page. Intentionally excludes before/after pairs (those live in the dedicated
// comparison sliders) and the customer-service trust photo (used in About).
export const galleryImages: GalleryImage[] = [
  { src: "/images/residential_driveway_raleigh_concrete_2.png", alt: "Newly poured residential driveway" },
  { src: "/images/back_patio_finished.png", alt: "Finished backyard concrete patio" },
  { src: "/images/pavers_backyard_porchsetup.png", alt: "Backyard paver porch setup" },
  { src: "/images/pavers_driveway.png", alt: "Custom paver driveway in Raleigh" },
  { src: "/images/retaining_wall.png", alt: "Block retaining wall installation" },
  { src: "/images/retaining-wall-brick.png", alt: "Brick retaining wall installation" },
  { src: "/images/patio_pavers.png", alt: "Paver patio with seating area" },
  { src: "/images/decorative_stamped_back_porch.png", alt: "Decorative stamped back porch concrete" },
  { src: "/images/decorative_stampted_back_patio.png", alt: "Decorative stamped back patio concrete" },
  { src: "/images/stamped_patio.png", alt: "Stamped concrete patio" },
  { src: "/images/front_walkway+driveway.png", alt: "Front walkway and driveway concrete work" },
  { src: "/images/walkway_concrete_front_of_house.png", alt: "Concrete walkway at a home's front entrance" },
  { src: "/images/pavers_front_porch-stairs.png", alt: "Paver front porch and stairs" },
  { src: "/images/stampted_patio_2.png", alt: "Stamped concrete patio detail" },
  { src: "/images/parkinglot-commercial-job.png", alt: "Commercial parking lot concrete project" },
  { src: "/images/commercial-entryway-clean.png", alt: "Clean commercial concrete entryway" },
  { src: "/images/commercial-sidewalk-entry-way-medical.png", alt: "Commercial sidewalk near medical building" },
  { src: "/images/walkway_entryway-commercial.png", alt: "Commercial walkway and entryway concrete" },
  { src: "/images/hoa_sidewalk_commercial.png", alt: "HOA commercial sidewalk concrete work" },
  { src: "/images/loadnig_dock_commercial.png", alt: "Commercial loading dock concrete project" },
  { src: "/images/driveway_close_up_detailed_8k.png", alt: "Broom-finished concrete driveway close-up" },
  { src: "/images/workers_pouring_driveway_live_action.png", alt: "Our crew pouring a new concrete driveway" },
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

export const sharedBeforeAfter: BeforeAfterPair[] = [
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
      "We build concrete driveways, patios, walkways and retaining walls for homeowners all over Raleigh. We show up when we say we will and keep communication clear from quote to finish. Quotes are free, usually the same day.",
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
      "New driveways, patios and retaining walls in Wake Forest. Usually wrapped up fast, done right, and built to handle North Carolina weather.",
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
  "chapel-hill": {
    key: "chapel-hill",
    city: "Chapel Hill",
    title: "Concrete & Hardscaping in Chapel Hill, NC",
    seoTitle: "Concrete Chapel Hill NC | Driveways, Patios & Pavers",
    description:
      "Concrete driveways, patios, walkways and retaining walls for Chapel Hill homeowners. Clean prep, durable finishes, and clear communication from quote to final cleanup.",
    heroImage: "/images/front_walkway+driveway.png",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Southern Village", "Meadowmont", "Chapel Hill North", "Glen Lennox", "Briar Chapel"],
  },
  morrisville: {
    key: "morrisville",
    city: "Morrisville",
    title: "Concrete & Hardscaping in Morrisville, NC",
    seoTitle: "Concrete Morrisville NC | Driveways, Patios & Pavers",
    description:
      "Concrete driveways, patios and walkways for Morrisville homeowners. We keep the schedule tight, the pricing clear, and the job site clean from start to finish.",
    heroImage: "/images/pavers_driveway.png",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Breckenridge", "Savannah", "Kitts Creek", "Carpenter Village", "Town Hall Commons"],
  },
  garner: {
    key: "garner",
    city: "Garner",
    title: "Concrete & Hardscaping in Garner, NC",
    seoTitle: "Concrete Garner NC | Driveways, Patios & Pavers",
    description:
      "New driveways, stamped patios and retaining walls for Garner homes. Solid prep, durable finishes, and work built to hold up to North Carolina weather.",
    heroImage: "/images/retaining-wall-brick.png",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Vandora Springs", "Heather Hills", "Cleveland", "Forest Hills", "White Oak"],
  },
  "holly-springs": {
    key: "holly-springs",
    city: "Holly Springs",
    title: "Concrete & Hardscaping in Holly Springs, NC",
    seoTitle: "Concrete Holly Springs NC | Driveways, Patios & Pavers",
    description:
      "Driveways, patios, walkways and paver work for Holly Springs homeowners. Free same-day quotes and a crew that treats your property like its own.",
    heroImage: "/images/patio_pavers.png",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Sunset Ridge", "12 Oaks", "Holly Glen", "Bass Lake", "Forest Springs"],
  },
  knightdale: {
    key: "knightdale",
    city: "Knightdale",
    title: "Concrete & Hardscaping in Knightdale, NC",
    seoTitle: "Concrete Knightdale NC | Driveways, Patios & Pavers",
    description:
      "Concrete and hardscaping for Knightdale homes: driveways, patios, slabs and retaining walls, done right the first time with clear communication throughout.",
    heroImage: "/images/decorative_stamped_back_porch.png",
    beforeAfterPairs: sharedBeforeAfter,
    neighborhoods: ["Princeton Manor", "Widewaters", "Emerald Crest", "Knightdale Station", "Mingo Creek"],
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
