// CRM wording, in one place. It used to carry a Spanish copy as well; that was
// retired, and the CRM is English only. The Locale type and dict() are kept so
// the pages that read strings through them didn't all need rewriting.
//
// Safe to import from client components - there are no server-only deps here.

export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
};

const en = {
  nav: {
    pipeline: "Pipeline",
    calendar: "Calendar",
    customers: "Customers",
    agreements: "Agreements",
    contractors: "Contractors",
    money: "Money",
    archived: "Archived",
    security: "Security",
    funnel: "Quote funnel",
    settings: "Settings",
    signOut: "Sign out",
    owner: "owner",
    contractor: "contractor",
  },
  status: {
    new: "New",
    quoted: "Quoted",
    approved: "Needs scheduling",
    scheduled: "Scheduled",
    completed: "Completed",
    paid: "Paid",
    lost: "Lost",
  },
  login: {
    title: "Team Login",
    subtitle: "Sign in to manage quotes, customers and contractors.",
    email: "Email",
    password: "Password",
    submit: "Sign In",
    submitting: "Signing in…",
    failed: "Could not sign in.",
    network: "Network error. Please try again.",
  },
  reset: {
    title: "Set your password",
    subtitle: "Choose a password before you continue.",
    newPassword: "New password",
    confirm: "Confirm password",
    submit: "Save password",
    submitting: "Saving…",
  },
  pipeline: {
    title: "Pipeline",
    quote: "quote",
    quotes: "quotes",
    assignedToYou: "assigned to you",
    dragHint: "drag a card or use Move to update it",
    search: "Search name, phone, address…",
    anyAssignee: "Any assignee",
    unassigned: "Unassigned",
    anyStatus: "Any status",
    filter: "Filter",
    clear: "Clear",
    empty: "Nothing here yet.",
    move: "Move",
    unassignedCard: "Unassigned",
    noQuotes: "No quotes",
    dropHere: "Drop here",
    crew: "Crew",
    serviceTBD: "Service TBD",
    typeOnline: "Online quote",
    typeInPerson: "In-person quote",
    typePlans: "From plans",
    pillJob: "Job",
    pillVisit: "Visit",
    pillViewed: "Viewed",
    textBtn: "Text",
    deleteLead: "Delete",
    // {name} is replaced with the customer's name.
    deleteConfirm: "Delete {name}'s lead from the pipeline? You can restore it later from Archived.",
    deleted: "Lead deleted. Restore it anytime from Archived.",
    errMove: "Could not move that quote.",
    errDelete: "Could not delete that lead.",
    nextUp: "Do this next",
    // {age} is how long it has been waiting, e.g. "3d".
    waitingFor: "waiting {age}",
    // {n} is how many other leads are also unquoted.
    alsoWaiting: "{n} more waiting",
    sittingOnWork: "Unquoted leads:",
    errAssign: "Could not assign.",
    // Phone only. The board becomes one stage at a time down there, so these
    // are the chips that pick which one, and the card's own controls fold away
    // behind Change so twenty jobs stay a list rather than a scroll.
    stagePicker: "Pick a stage",
    noneInStage: "Nothing in this stage.",
    change: "Change",
    tapHint: "tap a card to open it",
  },
  job: {
    backToAll: "← All quotes",
    customer: "Customer",
    phone: "Phone",
    email: "Email",
    service: "Service",
    type: "Type",
    typeOnline: "Online (photos)",
    typeInPerson: "In-person",
    typePlans: "From plans",
    requestedVisit: "Requested visit",
    offeredVisit: "If a visit is needed",
    offeredVisitHint: "not confirmed, the crew confirms this from the job page",
    preferredTime: "Preferred time",
    address: "Address",
    map: "Map",
    received: "Received",
    customerViews: "Customer views",
    firstViewed: "first",
    notOpened: "not opened yet",
    customerResponse: "Customer response",
    accepted: "Accepted",
    declined: "Declined",
    projectDetails: "Project details",
    photos: "Photos & video",
    noFiles: "No files were uploaded with this request.",
    noFilesInPerson: "This was an in-person request, so no photos were uploaded.",
    activity: "Activity",
    notScheduled: "Not scheduled yet",
    na: "N/A",
  },
  schedule: {
    notifyMoved: "Text the customer the new time",
    notifyMovedHint: "Turn this off if they already know, e.g. you called and came out the same day instead. The crew is still told.",
    confirmTitle: "Confirm the work day",
    bookedTitle: "Work day",
    waiting:
      "The customer approved and is waiting on a date. Confirming one books the job, texts them the day, and puts it on the calendar.",
    bookedFor: "Booked for",
    changeHint:
      "Changing it texts the customer that the date moved and re-invites the crew on the calendar.",
    customerPrefers: "Customer asked for these:",
    orPickAnother: "…or pick another day",
    workDay: "Work day",
    startTime: "Start time",
    confirm: "Confirm date",
    change: "Change date",
    saving: "Saving…",
    booked: "booked",
  },
  finish: {
    title: "Finish the job",
    confirmed: "Customer confirmed the date.",
    scheduledNote: "Installation scheduled. The customer gets a reminder to confirm two days before.",
    // No longer promises payment is a later step: it is on this same page now,
    // in the money card, and has been collectable since the day they approved.
    hint: "When the work is done on site, mark it completed to thank the customer and ask them for a review.",
    markCompleted: "Mark completed",
  },
  links: {
    title: "Shareable links",
    hint: "Text the customer link after you set an amount and summary. The job link shows photos and address to the assigned contractor, who has to be signed in to open it.",
    customerLink: "Customer quote (branded, tracked)",
    jobLink: "Contractor job link (photos + address)",
    regenerate: "Regenerate links",
    regenerateHint: "Invalidates the current links if one was shared too widely.",
    copy: "Copy",
    copied: "Copied",
  },
  editor: {
    status: "Status",
    assignedTo: "Assigned to",
    unassigned: "Unassigned",
    amount: "Quote amount",
    summary: "What the customer sees",
    notes: "Internal notes",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    sendQuote: "Send Quote",
    sending: "Sending…",
    sentOk: "Quote texted to the customer.",
    sentFailed: "Saved, but the text didn't send.",
  },
  settings: {
    title: "Settings",
    subtitle: "Update your name and the number we text for job alerts.",
    yourName: "Your name",
    alertNumber: "Alert number",
    email: "Email",
    language: "Language",
    languageHint: "The CRM shows in this language every time you sign in.",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    role: "Role",
    hoursTitle: "Working hours",
    hoursHint:
      "When customers can book an on-site quote visit with you. Visits are offered on the hour and run back to back, an hour apart.",
    hoursFrom: "First visit at",
    hoursTo: "Last visit at",
    hoursDays: "Days you take visits",
    hoursPreview: "Customers will see:",
    hoursNoDays: "Pick at least one day, otherwise nobody can book you.",
    hoursBackwards: "The last visit can't be earlier than the first.",
    hoursNote:
      "This only changes what a customer is offered. You can still book a visit at any time from the job page.",
  },
  calendar: {
    title: "Calendar",
    subtitle: "Booked jobs, in-person quote visits, and slots customers have asked for.",
    job: "Job",
    visit: "Visit",
    today: "Today",
    nothing: "Nothing scheduled.",
    viewSchedule: "Schedule",
    viewMonth: "Month",
    viewLabel: "Calendar view",
    prevMonth: "Previous month",
    nextMonth: "Next month",
    appointment: "Appointment",
    kindJob: "Job",
    kindInPerson: "In-person quote",
    kindOnline: "Online quote",
    tomorrow: "Tomorrow",
    yesterday: "Yesterday",
    // {n} is replaced with the number of days.
    inDays: "in {n} days",
    daysAgo: "{n} days ago",
    earlier: "Earlier",
    allDay: "All day",
    empty: "Nothing scheduled yet. Booked jobs and quote visits show up here.",
    dragHint: "Drag an appointment to another day to reschedule it.",
    // A slot an online customer offered in case photos aren't enough. Nobody
    // has agreed to it, so it says so on its face rather than only in a colour.
    notBooked: "Not booked",
    requestedNote:
      "This is a slot {name} offered in case photos aren't enough to price the job. Nobody has agreed to it and nobody is driving to it. Open the job to confirm it as a real visit, or price it from the photos and it disappears.",
    call: "Call",
    map: "Map",
    directions: "Directions",
    openJob: "Open job",
    reschedule: "Reschedule",
    remove: "Delete",
    stage: "Stage",
    service: "Service",
    address: "Address",
    date: "Date",
    time: "Time",
    saveNewTime: "Save new time",
    saving: "Saving…",
    removing: "Removing…",
    cancelAppt: "Cancel this appointment",
    unassigned: "Unassigned",
    everyone: "Everyone",
    crewLegend: "Who is going",
    askedLabel: "The customer asked to cancel",
    askedHint: "Changes their text from an apology to a confirmation.",
    keepIt: "Keep it",
    releaseDate: "Release the date",
    removeVisit: "Remove the visit",
    moveNoteJob: "The customer gets a text that their project moved, and the crew and calendar are updated.",
    moveNoteVisit: "The customer gets a text that their quote visit moved.",
    // {name} is replaced with the customer's name.
    warnJob: "This releases {name}'s work day. The job goes back to Needs scheduling and stays in your pipeline.",
    warnVisit: "This removes {name}'s quote visit. The lead stays in your pipeline.",
    notifyLabel: "Text {name} that it was cancelled",
    notifyHint: "Leave this on unless you have already spoken to them.",
    viewFullJob: "View the full job",
  },
  customers: {
    title: "Customers",
    subtitle: "Everyone who has asked for a quote, grouped by phone or email.",
    jobs: "jobs",
    wonValue: "Won value",
    lastSeen: "Last quote",
    searchPlaceholder: "Search name, phone, email…",
    search: "Search",
    reset: "Reset",
    empty: "No customers yet.",
    colCustomer: "Customer",
    colContact: "Contact",
    colQuotes: "Quotes",
    colLatest: "Latest",
    viewQuotes: "View quotes",
  },
  agreements: {
    title: "Agreements",
    subtitle: "Contracts for contractors and for jobs. Signing happens in DocuSeal; this is the record.",
    total: "Total",
    signed: "Signed",
    outstanding: "Outstanding",
    all: "All agreements",
    none: "Nothing tracked yet.",
    titleCol: "Title",
    typeCol: "Type",
    whoCol: "Who",
    statusCol: "Status",
    addedCol: "Added",
    contractor: "Contractor",
    customer: "Customer",
    viewFile: "File",
    openDocuseal: "DocuSeal",
    added: "Added",
    sent: "sent",
    signedOn: "signed",
    noneRecorded: "No agreements recorded yet.",
    statusPending: "Not sent",
    statusSent: "Awaiting signature",
    statusSigned: "Signed",
    statusDeclined: "Declined",
    statusVoid: "Void",
    viewFileFull: "View file",
    openDocusealFull: "Open in DocuSeal",
    update: "Update",
    remove: "Delete",
    ownerHint: "Add a contractor agreement on the Contractors page, or a customer agreement from that job's page.",
  },
  // The line-item builder. A quote is either one price or a list of things the
  // customer answers one at a time - "yes to the patio, no to the sidewalk" -
  // and these are the words on the crew's own screen while they write it.
  quoteOptions: {
    title: "Break the price into line items (optional)",
    // Leads with the breakdown, because that is what most customers who ask for
    // "line items" mean: show me what I'm paying for. Optional extras are the
    // second use, not the first.
    emptyHint:
      "Leave this empty for one price. Add a line for each part of the job to show the customer exactly what they're paying for - the total adds itself up. You can also add optional extras they can say yes or no to.",
    hint: "Every line is part of the job unless you let the customer say no to it. They only answer yes or no to the extras.",
    kindRequired: "Part of the job",
    kindOptional: "Their choice",
    itemTitle: "Item",
    itemTitlePlaceholder: "e.g. Back patio, 12x16",
    itemPrice: "Price ($)",
    itemDesc: "What this covers",
    itemDescPlaceholder: "What is included in this item specifically.",
    letThemChoose: "Let the customer say no to this one",
    requiredHint: "Always included. The customer sees the price but cannot drop it.",
    optionalHint: "The customer chooses. Say no and it comes off their total.",
    addOptional: "+ Add an optional extra",
    addRequired: "+ Add a line",
    remove: "Remove",
    moveUp: "Move up",
    moveDown: "Move down",
    allInTotal: "All in, if they take everything",
    // When every line is part of the job there is nothing to "take" - it is
    // just the total.
    total: "Total",
    // ── Split view: the price breakdown, and the extras kept apart from it ──
    // A customer who asks "how much is the concrete and how much is the labor"
    // is asking for this section, so it is the one that is always open.
    breakdownTitle: "Price breakdown",
    breakdownEmpty:
      "Show the customer what they're paying for: materials, labor and anything else, each with its own price. The total adds itself up. Leave it empty for a single price.",
    breakdownHint: "Every line here is part of the job. The customer sees each one, and the total is their sum.",
    breakdownLinePlaceholder: "e.g. Materials",
    breakdownDescPlaceholder: "Optional. e.g. 4,000 psi concrete, rebar and forms",
    // Against the price the customer is already holding. {quoted} is that
    // price, {diff} the gap.
    breakdownUnder: "Quoted price {quoted}. {diff} still to put on a line.",
    breakdownOver: "Quoted price {quoted}. These lines come to {diff} more.",
    breakdownMatches: "Adds up exactly to the quoted price of {quoted}.",
    // With two prices on offer, a line here is added to whichever they pick -
    // it is not a breakdown of either one, and the heading has to say so.
    breakdownChoiceTitle: "Added to every option",
    breakdownChoiceHint: "These lines are added to whichever option the customer picks.",
    extrasTitle: "Optional extras",
    extrasHint: "Add-ons the customer can say yes or no to. Each yes is added to their total.",
    extrasTotal: "If they take every extra",
    moreTitle: "More ways to price it",
    moreHint: "Optional extras the customer can say yes or no to, or the same job priced two ways.",
    acceptedTotal: "What they approved",
    lockedNote: "The customer has answered, so this is the record of what they bought. It cannot be changed.",
    answerYes: "Approved",
    answerNo: "Turned down",
    answerNone: "No answer",
  },
  // The other question customers ask, which line items cannot answer: not "and
  // also the sidewalk" but "or instead, in asphalt". Two complete ways of doing
  // the same job, and the customer picks exactly one.
  quotePackages: {
    title: "Give them a choice (optional)",
    emptyHint:
      "Most quotes need nothing here. Use it when the customer asked for the same job two ways - a concrete driveway or an asphalt one - so they can compare both prices on one page and pick one.",
    start: "+ Offer two ways to do this job",
    hint: "The customer picks one of these. Any line items above are added on top of whichever they pick.",
    optionWord: "Option",
    itemTitle: "What to call it",
    itemTitlePlaceholderA: "e.g. Concrete driveway",
    itemTitlePlaceholderB: "e.g. Asphalt driveway",
    itemPrice: "Price ($)",
    itemDesc: "Why they might pick this one",
    itemDescPlaceholder: "What they get, and what makes it different from the other option.",
    recommend: "This is the one I'd recommend",
    addAnother: "+ Add another option",
    remove: "Remove",
    moveUp: "Move up",
    moveDown: "Move down",
    needTwo:
      "Not a choice yet. This is saved, but the customer sees nothing and the quote can't be sent until there's a second option - or remove this card and it goes out as a single price.",
    leadNote: "Shown on the job here as:",
    lockedNote:
      "The customer has chosen, so this is the record of what they were offered and what they took. It cannot be changed.",
    answerPicked: "They picked this",
    answerNotPicked: "Not picked",
  },
  // "They said it's too much, send them the asphalt price too." One modal off
  // the Quotes sent card, rather than four screens of the quote editor.
  addOption: {
    open: "Send them another option",
    openHint: "{name} is holding this quote. Add a second way to do the job and they can compare both on the link they already have.",
    title: "Send another option",
    close: "Close",
    leadConvert:
      "{name} already has one price. Give it a name, add the second way of doing the job, and we'll text them a link that shows both side by side.",
    leadAdd: "Add another way of doing the job. {name} sees it alongside the ones they already have.",
    keepLegend: "The quote they already have",
    keepHint: "This is the price already on their phone. Name it so the two can be told apart, and correct the figure if it needs it.",
    keepNamePlaceholder: "e.g. Concrete driveway",
    alreadyOffered: "Already on this quote",
    addLegend: "The new option",
    addHint: "The other way of doing the same job. Its own price, not a discount off the first.",
    addNamePlaceholder: "e.g. Asphalt driveway",
    addCoversPlaceholder: "What they get, and what makes it different from the other option.",
    name: "What to call it",
    price: "Price ($)",
    covers: "Why they might pick this one",
    coversPlaceholder: "What is included in this one specifically.",
    recommendLabel: "Which would you recommend?",
    recommendNone: "No recommendation",
    previewLabel: "What {name} will see",
    previewUnnamed: "Not named yet",
    previewNote: "They pick one and their price is settled then. The link is the same one they already have, and the text never carries a price.",
    send: "Send both to {name}",
    sending: "Sending...",
    cancel: "Cancel",
    needBoth: "Every option needs a name and a price before this can go out.",
    sentOk: "Sent. {name} can compare both options on their link now.",
    sentHeld: "Saved. The text goes out {when}.",
    sentFailed: "The option was saved, but the text did NOT go out. Send them the quote link yourself.",
  },
  // Every version of the quote that has gone to this customer. Shown above the
  // logs on both job pages, because "what have we actually told them" is asked
  // before "who was told what and when".
  quoteLog: {
    title: "Quotes sent",
    none: "No quote has gone to this customer yet.",
    one: "1 quote sent",
    many: "{n} quotes sent",
    current: "Current",
    corrected: "Correction",
    optionAdded: "{title} added",
    first: "First quote",
    // Short on purpose: it sits in the price column, where a long string
    // wraps and makes one row taller than the rest.
    noPrice: "No price",
    retract: "Sent to the wrong customer?",
    retractWarn:
      "This kills the link {name} is holding, clears the price, the wording, any line items and any choice of options, stops a text that hasn't sent yet, and puts the job back in New. It cannot be undone.",
    retractGo: "Yes, retract it",
    retractKeep: "Keep it",
    retracting: "Retracting…",
  },
  // Writing down a yes that happened out loud. The card is on both job pages,
  // because the call lands wherever the person who takes it happens to be.
  acceptOffline: {
    title: "Approved over the phone?",
    lead: "If {name} said yes on a call, record it here instead of sending another quote for them to tap. You can set the day you agreed to at the same time - any day from today.",
    open: "Record their approval",
    // On a quote that offered a choice of ways to do the job, the first thing
    // to get out of the caller: which one. Nothing else on this form can be
    // filled in honestly until it is answered.
    whichOption: "Which option did they go with?",
    whichOptionHint: "They were offered a choice. Pick the one they agreed to on the call.",
    pickOption: "Say which option they took before recording the approval.",
    whatTheyTook: "What they agreed to",
    included: "In the job",
    yes: "Took it",
    no: "Left it",
    agreedTotal: "Agreed price:",
    bookNow: "We agreed a day on the call",
    bookNowHint: "Books it there and then. Leave it off if the day is still open and you'll settle it later.",
    startTime: "Start time",
    notifyLabel: "Text {name} to confirm",
    notifyHint: "Their written record of the call. Turn it off if you're still on the phone to them.",
    notifyHintBooked: "Sends them the day and time you just agreed. Turn it off if you're still on the phone to them.",
    warn: "This marks the quote approved in {name}'s name. The log records that you did it and that it came from a call, so only use it when they have actually said yes.",
    record: "Record the approval",
    recordAndBook: "Record it and book the day",
    recording: "Recording…",
    cancel: "Not yet",
    answerAll: "Mark every optional line took it or left it first.",
    tookNothing: "They left every line. That's a declined quote - ask the office to mark it lost.",
  },
  // Moving the price on a job that is already agreed, with the customer's say-so.
  // The crew take the call that starts this, so the card is on their page too.
  changeOrder: {
    title: "Customer wants a change?",
    lead: "Say what's changing and what the job comes to now, as one figure or broken down into materials, labor and more. They approve it on the same link they approved the job on, and nothing moves until they do.",
    open: "Send a change for approval",
    noteLabel: "What's changing",
    notePlaceholder: "Widening the patio from 12ft to 14ft, which adds about a yard of concrete and an extra hour of prep.",
    noteHint: "This goes to the customer word for word, so write it for them.",
    amountLabel: "New total for the whole job",
    amountHint: "Right now it's {now}. Change that figure to the new all-in price, not the difference.",
    difference: "Difference",
    alreadyPaid: "Already paid",
    newBalance: "New balance",
    sameTotal: "That's the total they already agreed to.",
    // ── The breakdown that can come with a change ──
    breakdownEmpty:
      "Optional. Break the new total into materials, labor and anything else, and the customer sees each line. Leave it empty to send one figure.",
    breakdownHint: "The customer sees each line, and the new total is their sum.",
    linesTitle: "New price breakdown",
    // The job had a breakdown and the change has none.
    linesGone: "The old breakdown comes off and the job goes back to one price.",
    sameTotalNewLines: "Same total as before. They're approving the new breakdown.",
    refundWarn: "That's less than they've already paid, so we'd owe them {amount} back. Worth a call before you send it.",
    sendHint: "{name} gets a text with the change and a link. Their date doesn't move.",
    // ── The preview, between composing a change and sending it ──
    // A change order is built on the job's balance, and the balance is built on
    // whatever the crew recorded as paid. If a deposit went in as the whole job,
    // every figure the customer is about to read is wrong - so the step before
    // sending shows the payments it was all worked from.
    review: "Review it before sending",
    reviewTitle: "This is what {name} will see",
    reviewBack: "Back to the change",
    reviewDateHeld: "Their date doesn't move: {when}",
    reviewApproved: "Price they approved",
    reviewAdds: "This change adds",
    reviewTakesOff: "This change takes off",
    // Same total, new breakdown. Matches the customer's own panel.
    reviewNoChange: "Change to the price",
    reviewNone: "None",
    reviewNewTotal: "New total",
    reviewPaid: "They've already paid",
    reviewLeft: "Left to pay",
    reviewBack2You: "Back to them",
    ledgerTitle: "Payments recorded on this job",
    ledgerNone: "Nothing has been recorded as paid on this job yet.",
    ledgerHint:
      "The balance above is worked out from these. If one of them is wrong, ask the office to correct it before you send this - the customer approves a balance, not just a total.",
    ledgerVoided: "voided, not counted",
    // The exact shape of the bug this preview exists to catch.
    paidInFullWarn:
      "Careful: this job already reads as paid in full and the work isn't finished. If only a deposit actually came in, the balance above is wrong. Ask the office to correct the payment before you send this.",
    confirmTick: "I've checked the payments above are right",
    // No deposit. The tick is now a statement that nothing has been taken.
    confirmTickNone: "I've checked - they haven't paid anything yet",
    ledgerHintNone:
      "So they'll be asked for the whole new total. If they did hand over a deposit that was never recorded, record it first.",
    sendTo: "Send it to {name}",
    send: "Send it for approval",
    sending: "Sending…",
    cancel: "Never mind",
    waitingTitle: "Change waiting on the customer",
    waitingLead: "{name} has the change and hasn't answered yet. The price is still the old one until they approve it.",
    waitingHint: "You'll get a text the moment they answer. If they'd rather settle it on the phone, withdraw it and the price stays as it is.",
    withdraw: "Withdraw this change",
    withdrawing: "Withdrawing…",
    nowTotal: "Agreed total",
    proposed: "If they approve",
    textFailed: "The text to {to} did NOT go out, so they have no link to answer. Give them a call.",
    textHeld: "Quiet hours - their text goes out {when}.",
  },
  contractorJob: {
    title: "Job Details",
    customer: "Customer",
    phone: "Phone",
    service: "Service",
    address: "Address",
    openInMaps: "Open in Maps",
    // The label over the date at the top of the page. Once a work day is booked
    // the pill above it already says "Installation scheduled", so this names
    // what the date IS rather than repeating the state: the day of the pour.
    scheduledJob: "Work day",
    quoteVisit: "Quote visit",
    preferredTime: "Preferred time",
    projectNotes: "Project notes",
    photos: "Photos & video",
    noFiles: "No files were uploaded for this job.",
    at: "at",
    schedTitle: "Confirm the work day",
    schedWaiting: "The customer approved and asked for these days and times. Tap the one that works and we'll text them straight away.",
    schedPickHint: "Nothing is booked until you confirm.",
    schedOther: "Or pick another day",
    schedStartTime: "Start time",
    schedConfirm: "Confirm this day",
    schedSaving: "Saving…",
    schedBooked: "Booked",
    schedNothing: "Nothing to schedule yet - the customer hasn't approved their quote.",
    reschedule: "Reschedule",
    reschedNewDay: "New day",
    // Spelled back out under every date picker on this page: the boxes
    // themselves are ordered by the phone, not by us, so this is the only
    // place the crew can see which day they actually picked.
    dateTooEarly: "{picked} has already passed. Pick {min} or later.",
    reschedSave: "Save the new time",
    reschedNoteJob: "The customer and the crew get a text with the new day.",
    reschedNoteVisit: "The customer and the crew get a text with the new visit time.",
    status: "Status",
    backToJobs: "← All my jobs",
    typeInPerson: "In-person quote",
    typeOnline: "Online quote",
    typePlans: "Priced from plans",
    priceFromPlans: "No visit - priced from the plans",
    notScheduled: "No date set yet",
    jobScheduled: "Installation scheduled",
    noVisitNeeded: "No visit needed - quote from the photos",
    // What has actually happened on this job, newest first. Deliberately not the
    // office's full audit log: a contractor needs the handful of moments that
    // change what they do next, not every note edit and internal price tweak.
    logTitle: "What's happened",
    logEmpty: "Nothing has happened on this job yet.",
    logMore: "Show earlier activity",
    log: {
      assigned: "Job assigned to the crew",
      quoteSent: "Quote sent to the customer",
      quoteRevised: "Corrected quote sent",
      quoteOptionAdded: "Another option sent: {title}",
      customerViewed: "Customer opened the quote",
      customerAccepted: "Customer approved the quote",
      // Never "Customer approved the quote" for one of these: on this log a
      // crew member needs to know whether the yes came from the customer's own
      // link or from somebody writing down a phone call.
      customerAcceptedPhone: "Approval recorded from a phone call",
      customerDeclined: "Customer declined the quote",
      visitConfirmed: "Quote visit confirmed",
      visitMoved: "Quote visit moved",
      visitCancelled: "Quote visit cancelled",
      changeSent: "Change sent to the customer to approve",
      changeAccepted: "Customer approved the change",
      changeDeclined: "Customer turned down the change",
      changeWithdrawn: "Change withdrawn",
      dateConfirmed: "Work day confirmed",
      dateChanged: "Work day moved",
      bookingCancelled: "Work day released",
      customerConfirmed: "Customer confirmed the day",
      jobCompleted: "Work marked completed",
      paymentReceived: "Payment received",
      paymentCorrected: "The office corrected a recorded payment",
      paymentVoided: "The office took a recorded payment off this job",
    },
    visitTitle: "Need to see it in person?",
    visitLead:
      "This came in as an online quote, so price it from the photos if you can. If the job is too big to call from pictures, confirm a visit and we'll text the customer.",
    visitScheduleTitle: "Schedule the on-site quote",
    visitScheduleLead:
      "This is an in-person quote with no date on it yet. Pick a day and time to go out and measure, and we'll text the customer to confirm.",
    visitAsked: "Customer offered",
    visitNotBooked: "Not booked yet",
    visitConfirm: "Confirm this visit",
    visitConfirming: "Confirming…",
    visitOther: "Pick a different day or time",
    visitTime: "Time",
    visitNote: "Confirming texts the customer and the crew with the day, time and address.",
    quoteWaitingTitle: "Quote sent - waiting on the customer",
    quoteWaitingLead: "{name} has the quote and hasn't replied yet",
    quoteWaitingSent: "Texted {when}",
    quoteWaitingHint:
      "It won't send twice - a second copy would just be the same text again. You'll get a message the moment they approve or decline. If they say it never arrived, ask the office to send it again.",
    quoteFixOpen: "Revise this quote or break down the price",
    quoteFixTitle: "Revise this quote",
    quoteFixLead:
      "Change the price or the wording, or break the price into materials, labor and more. We'll text {name} that the quote was updated, and the link they already have will show the new version.",
    quoteFixWho: "{name} gets a text saying the quote was updated, and it replaces the one they're holding.",
    quoteFixUnchanged:
      "Nothing has changed yet. Edit the price, a section or the breakdown, otherwise this is the same quote they already have.",
    quoteFixSend: "Send the revised quote",
    quoteFixOk: "Revised quote texted to the customer.",
    // What the customer actually bought on a quote with line items. The crew
    // needs this before they load the truck: "approved" does not say whether
    // there is a sidewalk to pour.
    approvedScope: "What they approved",
    approvedScopeHint: "Build these. Anything below them was turned down.",
    turnedDown: "Turned down",
    quoteTitle: "Quote this job",
    quoteLead: "Set a price and what's included, then we'll text it straight to the customer.",
    quoteOpen: "Quote job",
    quoteResend: "Send a new quote",
    quoteSentAlready: "Quote already sent:",
    quoteAmount: "Price ($)",
    quoteSummary: "What the customer sees",
    quotePlaceholder: "What's included, the scope, roughly how long it takes.",
    notApplicable: "Not applicable",
    quoteNeedPrice: "Add a price to send it.",
    quoteNeedSections: "Fill in {n} more to send it. Tap Not applicable if one doesn't apply.",
    sections: {
      quote_scope: "Scope",
      quote_permits: "Permits",
      quote_prep: "Demolition and prep",
      quote_pour: "Pour and finish",
      quote_cleanup: "Clean up",
    },
    sectionHints: {
      quote_scope: "What you're building, the size, and the finish.",
      quote_permits: "Who pulls them and what they cost.",
      quote_prep: "What comes out, what gets hauled, how the base is built.",
      quote_pour: "Depth, rebar or mesh, the mix, and the finish.",
      quote_cleanup: "How you leave the site, and when.",
    },
    quoteWho: "This texts {name} a link to their price.",
    quoteSend: "Send quote to customer",
    quoteSending: "Sending…",
    quoteOk: "Quote texted to the customer.",
    // Quiet hours held the customer's text. Not a failure and not a delivery,
    // so it gets its own line rather than borrowing either one's words - a
    // contractor told their quote failed at 9pm either sends it again or spends
    // the evening thinking the job is stuck.
    quoteQueued: "Saved. Their text is scheduled for {when} - we don't text customers between 7pm and 8am.",
    quoteFailed: "Saved, but the text didn't send. Call the office.",
    finishTitle: "Mark the job done",
    finishLead: "Once the work is finished on site, mark it done and we'll thank the customer.",
    finishChecklist: "Check these off before you close it out:",
    checkWork: "The work is finished as quoted",
    checkClean: "Site is cleaned up, tools and debris gone",
    checkCustomer: "Customer knows the job is finished",
    photosRequired: "Before and after photos are required to close a job out.",
    photosRequiredHint: "Add at least one before photo and one after photo.",
    photosBefore: "Before",
    photosAfter: "After",
    photosAdd: "Add photos",
    ourPhotos: "Our photos",
    finishSaving: "Closing out…",
    finishNote: "Anything the office should know? (optional)",
    finishNotePlaceholder: "Extra work, damage, something to follow up on…",
    finishAllRequired: "Tick all three boxes to close this job out.",
    finishConfirm: "This texts the customer a thank you and asks them for a review. Ready?",
    finishYes: "Yes, the work is done",
    doneTitle: "Work completed",
    doneNote: "Thanks. The office takes it from here.",
  },
  // The queued-text override. Quiet hours hold a customer's text until 8am,
  // which is right for a reminder and wrong for a corrected price, so there is
  // a way over the rule that names what it is doing rather than hiding it.
  heldText: {
    title: "Waiting to send",
    lead: "These texts are written and queued. They go out on their own, or you can send one now.",
    send: "Send now",
    sending: "Sending…",
    sent: "Sent. It has gone out now rather than waiting.",
    hint: "Sends it straight away instead of waiting its turn.",
    quietWarning: "It is outside our texting hours, so this reaches the customer now, whatever time it is for them.",
    waitingUntil: "Waiting until {when}",
    queuedFor: "Queued for {when}",
  },
  // Money on a job, as the crew sees it. Two facts and two actions: what the
  // customer still owes, what the crew owes the office, text a card link, or
  // record what was handed over.
  payments: {
    title: "Money on this job",
    total: "Job total",
    paid: "Paid so far",
    due: "Still to collect",
    settled: "Paid in full",
    noPrice: "No price on this job yet, so there's nothing to collect.",
    // The debt the cash board is built around. Named plainly, because a
    // contractor should never be surprised by it at the end of a month.
    owedTitle: "Your fee to the office",
    // The same three numbers said in the office's voice rather than the crew's.
    // "You owe" is right on a contractor's phone and wrong on the owner's desk.
    officeCut: "Office cut",
    feeTaken: "taken by card",
    feeLeft: "still owed",
    feeSettledLabel: "sent over by hand",
    owedNone: "Nothing owed - it came out of the card payment.",
    // The fee was paid, by the crew, after the fact. Not "it came out of the
    // card payment", which on a cash job is simply untrue.
    owedSettled: "Paid - you sent the office its cut. Nothing owed on this job.",
    owedCard: "Comes out of card payments automatically.",
    owedCash: "Send this over by Zelle or Venmo when you get a chance.",
    cardTitle: "Text them a card link",
    cardLead: "Card, Apple Pay or Google Pay. The money goes into your Stripe account, not the office's.",
    cardSend: "Text the payment link",
    cardSending: "Sending…",
    cardOff: "Card payments aren't switched on for you yet - ask the office to set it up.",
    cashTitle: "Record what they handed you",
    cashLead: "Cash, check, Zelle or Venmo. It counts straight away and the office gets a text.",
    amount: "How much?",
    method: "How did they pay?",
    noteLabel: "Note (optional)",
    notePlaceholder: "Anything the office should know",
    record: "Record this payment",
    recording: "Saving…",
    needAmount: "Enter how much they paid.",
    history: "Payments so far",
    waiting: "waiting on their bank",
    refunded: "refunded",
    refund: "Refund",
    refunding: "Refunding…",
    // {amount} is the sum going back to the customer.
    refundAsk: "Send {amount} back to the customer? The office fee goes back with it.",
    // ── Correcting a recorded payment (owner only) ──
    // The crew took a deposit and recorded the whole job. Nothing refused it,
    // and until now nothing could put it right outside the Supabase console.
    fixOpen: "Correct",
    fixTitle: "Correct what was recorded",
    // Deliberately says what this is NOT. An owner reaching for this button
    // while a customer is owed money needs to be sent to the refund instead.
    fixLead:
      "Use this when the figure keyed in isn't what the customer actually handed over. It changes the record only - no money moves either way. If money needs to go BACK to the customer, refund it instead.",
    fixWas: "Recorded as",
    fixAmount: "What they actually paid",
    fixMethod: "How they actually paid",
    fixNote: "Note (what was wrong)",
    fixSave: "Save the correction",
    fixSaving: "Saving…",
    fixCancel: "Leave it",
    fixCardOnly: "Card payments come from Stripe and can't be edited here.",
    fixZeroHint: "Nothing came in at all? Don't enter $0 - take it off the books below.",
    voidOpen: "Take this off the books",
    // {amount} is the figure coming off.
    voidAsk:
      "Void {amount}? Use this when the payment never happened at all - a duplicate, or money recorded against the wrong job. The row stays visible as voided so the books can still be reconciled.",
    voidReason: "Why is it coming off?",
    voidReasonHint: "Goes on the record, and the crew are told.",
    voidGo: "Void this payment",
    voiding: "Voiding…",
    voided: "voided",
    methods: {
      card: "Card",
      cash: "Cash",
      venmo: "Venmo",
      zelle: "Zelle",
      check: "Check",
      other: "Other",
    },
  },
  join: {
    language: "Language",
    fullName: "Full name",
    email: "Email (this is your username)",
    password: "Password (8+ characters)",
    confirm: "Confirm password",
    phone: "Mobile number for job alerts",
    phoneHint: "This is where we'll text you when a job is assigned to you. Leave it as-is if it's already right.",
    badPhone: "Enter a valid US mobile number, e.g. (919) 555-1234.",
    create: "Create my account",
    creating: "Creating your account…",
    needName: "Enter your full name.",
    needPassword: "Use a password of at least 8 characters.",
    mismatch: "The two passwords don't match.",
    doneEyebrow: "You're all set",
    doneTitle: "Your account is ready",
    doneNote: "Sign in with the password you just chose and this email:",
    goSignIn: "Go to sign in",
    title: "Set up your login",
    lead: "You've been invited to join the crew. Fill this in and you'll be able to sign in to see the jobs assigned to you.",
    eyebrow: "Crew Onboarding",
    invalidEyebrow: "Invite unavailable",
    invalidTitle: "This link isn't valid",
    invalidNote: "It may have already been used, been cancelled, or expired. Ask Raleigh Concrete Group to text you a new one.",
  },
  common: {
    cancel: "Cancel",
    close: "Close",
    error: "Something went wrong. Please try again.",
    sessionExpired: "Your session expired. Please sign in again.",
    na: "N/A",
  },
};

// The annotation is the point: TypeScript flags any key that's missing or
// misspelled here, so a partially translated release can't ship.
export type Dict = typeof en;

// English only. The argument is still accepted so the call sites that pass a
// staff member's stored locale keep compiling; every value gets English.
export function dict(_locale?: Locale | string | null): Dict {
  return en;
}

export const intlLocale = (_l?: Locale) => "en-US";

/**
 * A stored YYYY-MM-DD spelled out, e.g. "Friday, January 9, 2026".
 *
 * Parsed at local midnight rather than with `new Date(ymd)`, which reads a bare
 * date as UTC and lands on the day before.
 */
export function longDay(ymd: string, locale: Locale): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(intlLocale(locale), {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Fills {placeholders} in a dictionary string:
 *   fill(t.pipeline.deleteConfirm, { name: "Jane" })
 *
 * Word order differs between languages, which is exactly why these strings keep
 * the placeholder inside the sentence instead of being glued together from
 * fragments at the call site.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}
