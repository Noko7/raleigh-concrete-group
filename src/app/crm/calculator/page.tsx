import { requireSession } from "@/lib/crm/auth";
import { Calculator } from "./calculator";

export const dynamic = "force-dynamic";

export default async function CalculatorPage() {
  await requireSession();
  return (
    <main className="crm-page">
      <div className="crm-page-head">
        <div>
          <h1>Job Calculator</h1>
          <p className="crm-muted">Ballpark concrete volume, material, labor and a suggested price.</p>
        </div>
      </div>
      <Calculator />
    </main>
  );
}
