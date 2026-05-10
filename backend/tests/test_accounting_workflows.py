import unittest

from fastapi import HTTPException

from accounting import (
    apply_non_sellable_customer_return,
    apply_non_sellable_stock_move,
    apply_sellable_stock_return,
    apply_supplier_stock_return,
    build_return_allocation_plan,
    calculate_customer_ledger_totals,
    calculate_daily_ledger_totals,
    calculate_supplier_ledger_totals,
    compute_bill_payment_state,
    compute_followup_payment_state,
    compute_sales_return_financials,
)


class AccountingWorkflowTests(unittest.TestCase):
    def test_sales_payment_status_calculation(self):
        pending = compute_bill_payment_state(1000, 0)
        partial = compute_bill_payment_state(1000, 250)
        paid = compute_bill_payment_state(1000, 1000)
        overpaid = compute_bill_payment_state(1000, 1200)

        self.assertEqual(pending.payment_status, "Pending")
        self.assertEqual(pending.outstanding_amount, 1000)

        self.assertEqual(partial.payment_status, "Partial")
        self.assertEqual(partial.applied_paid_amount, 250)
        self.assertEqual(partial.outstanding_amount, 750)

        self.assertEqual(paid.payment_status, "Paid")
        self.assertEqual(paid.outstanding_amount, 0)

        self.assertEqual(overpaid.payment_status, "Paid")
        self.assertEqual(overpaid.applied_paid_amount, 1000)
        self.assertEqual(overpaid.change_amount, 200)

    def test_additional_payment_against_pending_bill(self):
        updated = compute_followup_payment_state(1000, 300, 400)
        self.assertEqual(updated.applied_paid_amount, 700)
        self.assertEqual(updated.outstanding_amount, 300)
        self.assertEqual(updated.payment_status, "Partial")

        with self.assertRaises(HTTPException):
            compute_followup_payment_state(1000, 900, 150)

    def test_sales_return_stock_update_sellable(self):
        batch_available, product_stock = apply_sellable_stock_return(5, 14, 3)
        self.assertEqual(batch_available, 8)
        self.assertEqual(product_stock, 17)

    def test_sales_return_credit_note_financials(self):
        financials = compute_sales_return_financials(300, 120, "Credit Note")
        self.assertEqual(financials["total_amount"], 300)
        self.assertEqual(financials["applied_outstanding_amount"], 120)
        self.assertEqual(financials["credit_note_amount"], 300)
        self.assertEqual(financials["refund_amount"], 0)
        self.assertTrue(financials["create_credit_note"])

        refund_financials = compute_sales_return_financials(300, 120, "Refund")
        self.assertEqual(refund_financials["applied_outstanding_amount"], 120)
        self.assertEqual(refund_financials["refund_amount"], 180)
        self.assertFalse(refund_financials["create_credit_note"])

    def test_sales_return_batch_allocation_rejects_excess(self):
        plan = build_return_allocation_plan(
            sold_allocations=[(11, 2), (12, 3)],
            previously_returned_allocations=[(11, 1)],
            requested_quantity=3,
        )
        self.assertEqual(plan, [(11, 1), (12, 2)])

        with self.assertRaises(HTTPException):
            build_return_allocation_plan(
                sold_allocations=[(11, 2)],
                previously_returned_allocations=[(11, 1)],
                requested_quantity=2,
            )

    def test_supplier_stock_return(self):
        available, non_sellable, stock, product_non_sellable = apply_supplier_stock_return(
            10,
            4,
            25,
            6,
            3,
            "SELLABLE",
        )
        self.assertEqual((available, non_sellable, stock, product_non_sellable), (7, 4, 22, 6))

        available, non_sellable, stock, product_non_sellable = apply_supplier_stock_return(
            10,
            4,
            25,
            6,
            2,
            "NON_SELLABLE",
        )
        self.assertEqual((available, non_sellable, stock, product_non_sellable), (10, 2, 25, 4))

    def test_damage_expiry_stock_adjustment(self):
        available, non_sellable, stock, product_non_sellable = apply_non_sellable_stock_move(
            12,
            1,
            20,
            3,
            4,
        )
        self.assertEqual((available, non_sellable, stock, product_non_sellable), (8, 5, 16, 7))

        returned_non_sellable, product_non_sellable_total = apply_non_sellable_customer_return(5, 7, 2)
        self.assertEqual((returned_non_sellable, product_non_sellable_total), (7, 9))

    def test_customer_ledger_update(self):
        totals = calculate_customer_ledger_totals(
            billed_amounts=[1000, 500],
            outstanding_amounts=[200, 0],
            payment_amounts=[400, 900],
            credit_note_amounts=[150],
        )
        self.assertEqual(totals["total_billed"], 1500)
        self.assertEqual(totals["total_paid"], 1300)
        self.assertEqual(totals["total_credit_notes"], 150)
        self.assertEqual(totals["outstanding_balance"], 200)

    def test_supplier_ledger_update(self):
        totals = calculate_supplier_ledger_totals(
            purchase_amounts=[2000, 800],
            payment_amounts=[1000],
            accepted_return_amounts=[300],
        )
        self.assertEqual(totals["total_purchases"], 2800)
        self.assertEqual(totals["total_paid"], 1000)
        self.assertEqual(totals["total_returns"], 300)
        self.assertEqual(totals["outstanding_balance"], 1500)

    def test_daily_ledger_calculation(self):
        totals = calculate_daily_ledger_totals(
            sales_by_mode={"Cash": 1000, "UPI": 500, "Card": 250, "Credit": 700},
            collections=1400,
            outstanding=700,
            sales_return_value=120,
            supplier_return_credit=60,
            purchase_payments=300,
        )
        self.assertEqual(totals["cash_sales"], 1000)
        self.assertEqual(totals["upi_sales"], 500)
        self.assertEqual(totals["card_sales"], 250)
        self.assertEqual(totals["credit_sales"], 700)
        self.assertEqual(totals["purchase_payments"], 300)
        self.assertEqual(totals["sales_returns"], 120)
        self.assertEqual(totals["stock_return_credit"], 60)
        self.assertEqual(totals["total_collection"], 1400)
        self.assertEqual(totals["total_outstanding"], 700)


if __name__ == "__main__":
    unittest.main()
