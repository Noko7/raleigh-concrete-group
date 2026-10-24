import { links, phoneDisplay } from "@/lib/site-data";

/** Call and text, for the customer's quote, payment and confirm pages. */
export function ContactButtons() {
  return (
    <div className="cq-cta">
      <a href={links.call} className="cq-btn cq-btn-primary">
        Call {phoneDisplay}
      </a>
      <a href={links.text} className="cq-btn cq-btn-secondary">
        Text Us
      </a>
    </div>
  );
}
