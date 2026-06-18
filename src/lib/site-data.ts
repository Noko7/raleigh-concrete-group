// ── Raleigh Concrete Group - central site data ──────────────────────────────
// Edit content here; the homepage, location pages, header and SEO all read from it.

export const businessName = "Raleigh Concrete Group";
export const phoneDisplay = "(919) 897-7695";
export const phoneHref = "tel:+19198977695";
export const textHref = "sms:+19198977695";

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
// We intentionally limit this matrix to the core money services so each page
// carries substantial, genuinely localized copy rather than thin doorway-style
// boilerplate. Every combination gets a unique intro that weaves in the city
// and two real neighborhoods.
export const cityServiceSlugs = coreServices.map((s) => s.slug);

export const cityServicePairs: { location: LocationKey; service: string }[] =
  locationKeys.flatMap((location) =>
    cityServiceSlugs.map((service) => ({ location, service })),
  );

export function isCityServicePair(location: string, service: string): boolean {
  return (
    locationKeys.includes(location as LocationKey) &&
    cityServiceSlugs.includes(service)
  );
}

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

// ── Hand-written priority pages ──
// These combinations get fully bespoke copy (unique intro, a representative
// local project, neighborhood detail and city-specific FAQs) instead of the
// generated template, because they're the highest-intent, highest-volume
// searches. Keyed by `${locationKey}/${slug}`. Project examples are framed as
// "what a typical project here looks like" so nothing claims a specific past
// customer.
type PriorityContent = { intro: string[]; projectExample: string; faqs: FaqItem[] };

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
};

function cityServiceParagraphs(service: Service, city: string, hoods: string[]): string[] {
  const a = hoods[0] ?? city;
  const b = hoods[1] ?? "the surrounding area";
  const lead: Record<string, string[]> = {
    "concrete-driveways": [
      `Need a new concrete driveway in ${city}? We pour and replace driveways for homeowners all over ${city}, from ${a} to ${b}, with proper base prep so they hold up to daily traffic and North Carolina weather.`,
      `Whether you're tearing out a cracked, sinking slab or paving fresh, we handle the full job, broom, smooth or stamped finish included, and we can usually get you a same-day quote on a ${city} driveway from satellite imagery.`,
    ],
    "retaining-walls": [
      `We build engineered concrete and block retaining walls across ${city}, including ${a} and ${b}, to handle grading, drainage and erosion on sloped lots.`,
      `The walls that fail are almost always the ones with bad drainage behind them, so we build in gravel backfill and proper drainage from the start. We'll tell you up front whether your ${city} project needs a permit or engineering.`,
    ],
    "paver-patios": [
      `Thinking about a paver patio in ${city}? We design and install paver patios for homes in ${a}, ${b} and throughout ${city}, on a compacted base with edge restraints so they stay level for years.`,
      `Pavers give you a huge range of colors and patterns, flex with the ground instead of cracking, and individual units can be lifted and reset if you ever need to. We'll walk you through the options for your ${city} backyard.`,
    ],
    "concrete-patios": [
      `A concrete patio is one of the most cost-effective ways to add usable outdoor space to a ${city} home. We pour patios across ${a}, ${b} and the rest of ${city} with broom, smooth, exposed-aggregate or stamped finishes.`,
      `Most ${city} patios are poured within a day or two once the site is prepped, and we handle the layout, base and finish so it drains correctly and looks clean against your house.`,
    ],
    "walkways-sidewalks": [
      `We build concrete walkways and sidewalks for ${city} homeowners, tying ${a} and ${b} properties together with clean, safe, properly graded paths.`,
      `New walkways are usually finished in a day, and we match width, finish and joint spacing to your existing concrete as closely as possible so the addition looks like it belongs.`,
    ],
    "stamped-decorative-concrete": [
      `Want the look of stone, brick or slate without the price tag in ${city}? We install stamped and decorative concrete for patios, walkways and pool decks across ${a}, ${b} and all of ${city}.`,
      `Stamped concrete usually costs less to install than natural stone or pavers, and with a periodic re-seal it holds its color and pattern for years against North Carolina sun and rain. We can add a non-slip additive on ${city} pool decks and walkways.`,
    ],
  };
  return lead[service.slug] ?? [service.intro];
}

export function getCityServiceContent(
  locationKey: LocationKey,
  slug: string,
): CityServiceContent | null {
  const service = getService(slug);
  if (!service || !cityServiceSlugs.includes(slug)) return null;
  const location = locations[locationKey];
  const city = location.city;
  const hoods = location.neighborhoods;

  const bespoke = cityServiceLocalContent[`${locationKey}/${slug}`];

  const paragraphs = bespoke ? bespoke.intro : cityServiceParagraphs(service, city, hoods);

  const faqs: FaqItem[] = bespoke
    ? bespoke.faqs
    : [
        {
          q: `Do you offer ${service.name.toLowerCase()} in ${city}?`,
          a: `Yes. ${service.name} is one of our core services and we work throughout ${city}, including ${hoods.slice(0, 2).join(" and ")}. Estimates are free and usually same-day.`,
        },
        ...getServiceSpecificFaqs(slug),
      ];

  return {
    service,
    city,
    locationKey,
    neighborhoods: hoods,
    metaTitle: `${service.name} in ${city}, NC`,
    metaDescription: `${service.name} in ${city}, NC. ${service.blurb} Free same-day quotes from a local Triangle crew.`,
    heading: `${service.name} in ${city}, NC`,
    paragraphs,
    projectExample: bespoke ? bespoke.projectExample : null,
    faqs,
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
