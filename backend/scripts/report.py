"""Print the processing outcome of every non-historical invoice (`python -m scripts.report`)."""
from __future__ import annotations

from collections import Counter

from sqlalchemy import select

from app.db.models import Invoice, IntakeItem
from app.db.session import session_scope
from app.services import pipeline


def main() -> None:
    states: Counter[str] = Counter()
    codes: Counter[str] = Counter()
    with session_scope() as s:
        for inv in s.scalars(select(Invoice).where(Invoice.source_kind != "historical_ledger").order_by(Invoice.id)):
            v = pipeline.current_version(s, inv)
            block = sorted({f.code for f in pipeline.blocking_findings(s, inv.id, v.version)})
            warn = sorted({f.code for f in pipeline.latest_findings(s, inv.id, v.version)
                           if f.result in {"FAIL", "UNKNOWN"} and not f.blocking})
            chain = [(st.step_key, st.assigned_actor_id) for st in pipeline.approval_steps(s, inv.id, v.version)]
            states[inv.lifecycle_state] += 1
            codes.update(block)
            print(f"{inv.id:12} {(v.vendor_name_raw or '')[:26]:26} {v.invoice_number_raw or '-':12} "
                  f"{(v.amount_cad_minor or 0) / 100:>10,.2f} {inv.lifecycle_state:16} risk={inv.risk_band or '-':20} "
                  f"block={block} warn={warn} chain={chain}")
        print("\nstates:", dict(states))
        print("blocking codes:", dict(codes))
        for it in s.scalars(select(IntakeItem).where(IntakeItem.invoice_id.is_(None))):
            print("work item:", it.id, it.item_type, it.status, it.note)


if __name__ == "__main__":
    main()
