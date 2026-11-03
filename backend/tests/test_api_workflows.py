"""Endpoint-level regression tests that run the real API against a disposable PostgreSQL.

Skipped unless TEST_DATABASE_URL is set, e.g.
    TEST_DATABASE_URL=postgresql+asyncpg://postgres@localhost:55432/stockpro_test

The schema is DROPPED and recreated for every test. Only localhost databases are accepted.
"""
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path

from sqlalchemy.engine import make_url

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

if TEST_DATABASE_URL:
    if make_url(TEST_DATABASE_URL).host not in {"localhost", "127.0.0.1"}:
        raise RuntimeError("TEST_DATABASE_URL must point at a local throwaway database.")
    # Point the app's own engine at the test database as well, so nothing can reach a real one.
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    os.environ.setdefault("JWT_SECRET_KEY", "test-only-secret")


@unittest.skipUnless(TEST_DATABASE_URL, "set TEST_DATABASE_URL to a disposable local PostgreSQL database")
class ApiWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import httpx
        from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import NullPool

        import database
        import main
        import models
        from routers import sales
        from security import get_current_user

        self.app = main.app
        self.sales_router = sales
        self.engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(models.Base.metadata.drop_all)
            await conn.run_sync(models.Base.metadata.create_all)
        session_factory = sessionmaker(bind=self.engine, class_=AsyncSession, expire_on_commit=False)

        async def override_get_db():
            async with session_factory() as db:
                yield db

        self.app.dependency_overrides[database.get_db] = override_get_db
        self.app.dependency_overrides[get_current_user] = lambda: models.User(
            id=1, username="tester", role="admin", must_change_password=False
        )

        self.exports_dir = tempfile.TemporaryDirectory()
        self.original_exports_root = sales.EXPORTS_ROOT
        sales.EXPORTS_ROOT = Path(self.exports_dir.name)

        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.app.dependency_overrides.clear()
        self.sales_router.EXPORTS_ROOT = self.original_exports_root
        self.exports_dir.cleanup()
        await self.engine.dispose()

    async def request(self, method, path, json=None, expected=200):
        response = await self.client.request(method, f"/api/v1{path}", json=json)
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    async def create_bill_with_outstanding(self):
        """Purchase 10 units at 100, sell 4 to a customer for 400 with 100 paid -> 300 outstanding."""
        supplier = await self.request("POST", "/suppliers", {"company_name": "Test Supplier", "gst_number": "27ABCDE1234F1Z5"})
        customer = await self.request("POST", "/customers", {"name": "Test Customer"})
        product = await self.request("POST", "/products", {"brand_name": "Acme", "product_name": "Soap"})
        await self.request("POST", "/purchase-invoices", {
            "supplier_id": supplier["id"],
            "invoice_number": "P-1",
            "invoice_date": date.today().isoformat(),
            "total_amount": 1000,
            "items": [{"product_id": product["id"], "quantity": 10, "unit_price": 100, "gst_percent": 0, "line_total": 1000}],
        })
        bill = await self.request("POST", "/sales", {
            "customer_id": customer["id"],
            "subtotal": 400,
            "taxable_amount": 400,
            "grand_total": 400,
            "paid_amount": 100,
            "payment_mode": "Cash",
            "items": [{"product_id": product["id"], "quantity": 4, "selling_price": 100, "gst_percent": 0,
                       "discount_percent": 0, "final_amount": 400}],
        })
        self.assertEqual(bill["outstanding_amount"], 300)
        detail = await self.request("GET", f"/sales/{bill['id']}")
        return customer, product, detail

    async def create_return(self, bill, product, quantity, amount, settlement_type, stock_action="SELLABLE", expected=200):
        return await self.request("POST", "/sales-returns", {
            "bill_id": bill["id"],
            "reason": "Customer return",
            "settlement_type": settlement_type,
            "items": [{
                "sale_item_id": bill["sales_items"][0]["id"],
                "product_id": product["id"],
                "quantity": quantity,
                "amount": amount,
                "stock_action": stock_action,
                "reason": "Customer return",
            }],
        }, expected=expected)

    async def test_product_update_cannot_overwrite_stock(self):
        _, product, _ = await self.create_bill_with_outstanding()
        self.assertEqual((await self.request("GET", f"/products/{product['id']}"))["current_stock"], 6)

        # An edit form holding a stale stock value must not change stock.
        await self.request("PUT", f"/products/{product['id']}", {
            "brand_name": "Acme", "product_name": "Soap Renamed", "packing_type": "Unit",
            "units_per_pack": 1, "current_stock": 999,
        })
        updated = await self.request("GET", f"/products/{product['id']}")
        self.assertEqual(updated["product_name"], "Soap Renamed")
        self.assertEqual(updated["current_stock"], 6)

        created = await self.request("POST", "/products", {"product_name": "New Item", "current_stock": 50})
        self.assertEqual(created["current_stock"], 0)

    async def test_credit_note_return_reduces_outstanding_once(self):
        customer, product, bill = await self.create_bill_with_outstanding()

        sales_return = await self.create_return(bill, product, quantity=1, amount=100, settlement_type="Credit Note")

        self.assertEqual(sales_return["applied_outstanding_amount"], 100)
        self.assertEqual(sales_return["credit_note_amount"], 100)
        self.assertEqual((await self.request("GET", f"/sales/{bill['id']}"))["outstanding_amount"], 200)
        [credit_note] = await self.request("GET", "/credit-notes")
        self.assertEqual((credit_note["amount"], credit_note["applied_amount"], credit_note["status"]), (100, 100, "Applied"))
        ledger = await self.request("GET", f"/customers/{customer['id']}/ledger")
        self.assertEqual(ledger["outstanding_balance"], 200)
        self.assertEqual((await self.request("GET", f"/products/{product['id']}"))["current_stock"], 7)

    async def test_credit_note_larger_than_outstanding_keeps_remaining_credit(self):
        _, product, bill = await self.create_bill_with_outstanding()

        sales_return = await self.create_return(bill, product, quantity=4, amount=400, settlement_type="Credit Note")

        self.assertEqual(sales_return["applied_outstanding_amount"], 300)
        self.assertEqual((await self.request("GET", f"/sales/{bill['id']}"))["outstanding_amount"], 0)
        [credit_note] = await self.request("GET", "/credit-notes")
        self.assertEqual((credit_note["amount"], credit_note["applied_amount"], credit_note["status"]), (400, 300, "Partially Applied"))

    async def test_supplier_ledger_loads_with_stock_returns(self):
        supplier = await self.request("POST", "/suppliers", {"company_name": "Ledger Supplier", "gst_number": "27ABCDE1234F1Z5"})
        product = await self.request("POST", "/products", {"product_name": "Shampoo"})
        await self.request("POST", "/purchase-invoices", {
            "supplier_id": supplier["id"],
            "invoice_number": "P-2",
            "invoice_date": date.today().isoformat(),
            "total_amount": 500,
            "items": [{"product_id": product["id"], "quantity": 5, "unit_price": 100, "gst_percent": 0, "line_total": 500}],
        })
        await self.request("POST", "/stock-returns", {
            "supplier_id": supplier["id"],
            "reason": "Damaged in transit",
            "status": "Accepted",
            "credit_amount": 200,
            "items": [{"product_id": product["id"], "quantity": 2, "amount": 200, "reason": "Damaged in transit"}],
        })

        ledger = await self.request("GET", f"/suppliers/{supplier['id']}/ledger")
        self.assertEqual(len(ledger["stock_returns"]), 1)
        self.assertEqual(len(ledger["stock_returns"][0]["items"]), 1)
        self.assertEqual(ledger["outstanding_balance"], 300)

    async def test_damaged_return_moves_stock_to_non_sellable(self):
        _, product, bill = await self.create_bill_with_outstanding()

        sales_return = await self.create_return(
            bill, product, quantity=2, amount=200, settlement_type="Refund", stock_action="DAMAGED"
        )

        self.assertEqual(sales_return["applied_outstanding_amount"], 200)
        self.assertEqual(sales_return["refund_amount"], 0)
        refreshed = await self.request("GET", f"/products/{product['id']}")
        self.assertEqual((refreshed["current_stock"], refreshed["non_sellable_stock"]), (6, 2))
        self.assertEqual((await self.request("GET", f"/sales/{bill['id']}"))["outstanding_amount"], 100)


if __name__ == "__main__":
    unittest.main()
