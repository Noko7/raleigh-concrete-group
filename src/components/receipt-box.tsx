// "Text the customer a receipt", on every form that records a customer payment. Ticked by default: unticking
// is the deliberate act. The hidden field tells the server the box was on the form, so an unticked box (which
// posts nothing) isn't mistaken for an old form that never had one (customerReceiptChoice).
export function ReceiptBox({
  label,
  hint,
  className = "receipt-box",
  disabled,
}: {
  label: string;
  hint?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={className}>
      <input type="hidden" name="receipt_box" value="1" />
      <label>
        <input type="checkbox" name="send_receipt" defaultChecked disabled={disabled} />
        <span>{label}</span>
      </label>
      {hint && <p className="receipt-box-hint">{hint}</p>}
    </div>
  );
}
