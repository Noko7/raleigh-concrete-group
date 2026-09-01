import {
  BUSINESS_TZ,
  QUIET_FROM_HOUR,
  QUIET_UNTIL_HOUR,
  clockLabel,
  hourLabel,
  inQuietHours,
  nextSendableAt,
  now,
} from "@/lib/crm/clock";
import { DRIFT_TOLERANCE_SECONDS, type ClockCheck } from "@/lib/crm/time-check";

// What time the app thinks it is, and whether that can be trusted.
//
// Worth a panel of its own because two things now hang off it: every date on
// every screen is rendered in Raleigh time rather than the server's UTC, and
// texts are held between 7pm and 8am. Both are silently wrong if the clock is
// wrong, and a clock is the one component that never announces its own failure.
export function ClockCard({ check }: { check: ClockCheck }) {
  const at = now();
  const quiet = inQuietHours(at);
  const drift = check.driftSeconds ?? 0;
  const accurate = check.ok && Math.abs(drift) <= DRIFT_TOLERANCE_SECONDS;

  return (
    <section className="crm-card">
      <h2 className="crm-card-title">Time &amp; quiet hours</h2>

      <dl className="crm-dl clock-diag">
        <div>
          <dt>Right now</dt>
          <dd>
            {new Intl.DateTimeFormat("en-US", {
              timeZone: BUSINESS_TZ,
              dateStyle: "full",
              timeStyle: "long",
            }).format(at)}
          </dd>
        </div>
        <div>
          <dt>Zone</dt>
          <dd>
            {BUSINESS_TZ} - Eastern, so EST in winter and EDT in summer. Every date in the CRM, on the job pages and in
            the texts is written in this zone, whatever the server or the phone reading it is set to.
          </dd>
        </div>
        <div>
          <dt>Customer texts</dt>
          <dd>
            {quiet ? (
              <>
                <span className="crm-badge crm-badge-warning">Quiet hours</span> A text to a customer is queued now and
                sends {clockLabel(nextSendableAt(at), at)}. The exception is the receipt for a quote request, which goes
                out at once because they just pressed the button and are waiting on it.
              </>
            ) : (
              <>
                <span className="crm-badge crm-badge-success">Sending</span> Customer texts go out as they happen, until{" "}
                {hourLabel(QUIET_FROM_HOUR)}. Between {hourLabel(QUIET_FROM_HOUR)} and {hourLabel(QUIET_UNTIL_HOUR)} they
                are held and delivered the next morning.
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Your texts</dt>
          <dd>
            <span className="crm-badge crm-badge-success">Any time</span> Quiet hours never apply to you or the crew.
            Lead alerts, crew reminders and logins send the moment they happen, at any hour.
          </dd>
        </div>
        <div>
          <dt>Clock check</dt>
          <dd>
            {!check.ok ? (
              // Not being able to reach a time server says nothing about our own
              // clock, so this is grey rather than red.
              <span className="crm-muted">Couldn&apos;t reach a time source to compare against. {check.error}</span>
            ) : accurate ? (
              <>
                <span className="crm-badge crm-badge-success">Accurate</span> Within {Math.abs(drift)}s of {check.source}
                . The host clock is kept in step by the platform, so this is a check rather than a correction.
              </>
            ) : (
              <>
                <span className="crm-badge crm-badge-danger">Off by {drift}s</span> This server disagrees with{" "}
                {check.source} by more than {DRIFT_TOLERANCE_SECONDS} seconds. Dates and quiet hours are running against
                a clock that is wrong - redeploy, and if it persists it is worth raising with Vercel.
              </>
            )}
          </dd>
        </div>
      </dl>

      <p className="crm-muted crm-sm">
        Time comes from the machine this runs on, not from an NTP pool: serverless functions get outbound TCP only, and
        port 123 isn&apos;t open to them. It isn&apos;t a downgrade - Vercel runs on AWS instances disciplined by
        Amazon&apos;s own time service, which is steadier than a public pool server reached across the internet. The
        line above is the second opinion.
      </p>
    </section>
  );
}
