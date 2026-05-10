"""Add accounting workflow tables and additive stock/payment fields

Revision ID: 9b7f6c4d2e10
Revises: f4b9c7d2a1e0
Create Date: 2026-05-10 19:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9b7f6c4d2e10"
down_revision: Union[str, Sequence[str], None] = "f4b9c7d2a1e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("non_sellable_stock", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "stock_batches",
        sa.Column("non_sellable_quantity", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "stock_adjustments",
        sa.Column("final_action", sa.String(), nullable=True, server_default="Adjusted"),
    )
    op.add_column("payment_transactions", sa.Column("reference_number", sa.String(), nullable=True))
    op.add_column(
        "payment_transactions",
        sa.Column("is_initial_payment", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "customer_ledger",
        sa.Column("total_billed", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column(
        "customer_ledger",
        sa.Column("total_credit_notes", sa.Float(), nullable=False, server_default="0"),
    )
    op.execute("UPDATE customer_ledger SET total_billed = COALESCE(total_credit, 0)")

    op.create_table(
        "supplier_ledger",
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("total_purchases", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_paid", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_returns", sa.Float(), nullable=False, server_default="0"),
        sa.Column("outstanding_balance", sa.Float(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
        sa.PrimaryKeyConstraint("supplier_id"),
    )

    op.create_table(
        "sales_returns",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("return_number", sa.String(), nullable=True),
        sa.Column("bill_id", sa.Integer(), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=True),
        sa.Column("return_date", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("settlement_type", sa.String(), nullable=False, server_default="Credit Note"),
        sa.Column("total_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("applied_outstanding_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("refund_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("credit_note_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(), nullable=False, server_default="Completed"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["bill_id"], ["sales_bills.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sales_returns_id"), "sales_returns", ["id"], unique=False)
    op.create_index(op.f("ix_sales_returns_return_number"), "sales_returns", ["return_number"], unique=True)

    op.create_table(
        "credit_notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_number", sa.String(), nullable=True),
        sa.Column("bill_id", sa.Integer(), nullable=True),
        sa.Column("customer_id", sa.Integer(), nullable=True),
        sa.Column("sales_return_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("applied_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("credit_date", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("status", sa.String(), nullable=False, server_default="Open"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["bill_id"], ["sales_bills.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["sales_return_id"], ["sales_returns.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_credit_notes_id"), "credit_notes", ["id"], unique=False)
    op.create_index(op.f("ix_credit_notes_note_number"), "credit_notes", ["note_number"], unique=True)

    op.create_table(
        "sales_return_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sales_return_id", sa.Integer(), nullable=False),
        sa.Column("sale_item_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("stock_action", sa.String(), nullable=False, server_default="SELLABLE"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("product_name_snapshot", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["sale_item_id"], ["sales_items.id"]),
        sa.ForeignKeyConstraint(["sales_return_id"], ["sales_returns.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sales_return_items_id"), "sales_return_items", ["id"], unique=False)

    op.create_table(
        "sales_return_batch_allocations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sales_return_item_id", sa.Integer(), nullable=False),
        sa.Column("stock_batch_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["sales_return_item_id"], ["sales_return_items.id"]),
        sa.ForeignKeyConstraint(["stock_batch_id"], ["stock_batches.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_sales_return_batch_allocations_id"),
        "sales_return_batch_allocations",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_sales_return_batch_allocations_sales_return_item_id"),
        "sales_return_batch_allocations",
        ["sales_return_item_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_sales_return_batch_allocations_stock_batch_id"),
        "sales_return_batch_allocations",
        ["stock_batch_id"],
        unique=False,
    )

    op.create_table(
        "supplier_stock_returns",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("return_number", sa.String(), nullable=True),
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("return_date", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="Pending"),
        sa.Column("credit_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_supplier_stock_returns_id"), "supplier_stock_returns", ["id"], unique=False)
    op.create_index(
        op.f("ix_supplier_stock_returns_return_number"),
        "supplier_stock_returns",
        ["return_number"],
        unique=True,
    )

    op.create_table(
        "supplier_stock_return_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("supplier_stock_return_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("stock_batch_id", sa.Integer(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("stock_source", sa.String(), nullable=False, server_default="SELLABLE"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("product_name_snapshot", sa.String(), nullable=True),
        sa.Column("batch_number_snapshot", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["stock_batch_id"], ["stock_batches.id"]),
        sa.ForeignKeyConstraint(["supplier_stock_return_id"], ["supplier_stock_returns.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_supplier_stock_return_items_id"),
        "supplier_stock_return_items",
        ["id"],
        unique=False,
    )

    op.create_table(
        "supplier_payment_transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("payment_mode", sa.String(), nullable=False),
        sa.Column("payment_date", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("reference_number", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_supplier_payment_transactions_id"),
        "supplier_payment_transactions",
        ["id"],
        unique=False,
    )

    op.alter_column("products", "non_sellable_stock", server_default=None)
    op.alter_column("stock_batches", "non_sellable_quantity", server_default=None)
    op.alter_column("stock_adjustments", "final_action", server_default=None)
    op.alter_column("payment_transactions", "is_initial_payment", server_default=None)
    op.alter_column("customer_ledger", "total_billed", server_default=None)
    op.alter_column("customer_ledger", "total_credit_notes", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_supplier_payment_transactions_id"), table_name="supplier_payment_transactions")
    op.drop_table("supplier_payment_transactions")

    op.drop_index(op.f("ix_supplier_stock_return_items_id"), table_name="supplier_stock_return_items")
    op.drop_table("supplier_stock_return_items")

    op.drop_index(op.f("ix_supplier_stock_returns_return_number"), table_name="supplier_stock_returns")
    op.drop_index(op.f("ix_supplier_stock_returns_id"), table_name="supplier_stock_returns")
    op.drop_table("supplier_stock_returns")

    op.drop_index(
        op.f("ix_sales_return_batch_allocations_stock_batch_id"),
        table_name="sales_return_batch_allocations",
    )
    op.drop_index(
        op.f("ix_sales_return_batch_allocations_sales_return_item_id"),
        table_name="sales_return_batch_allocations",
    )
    op.drop_index(op.f("ix_sales_return_batch_allocations_id"), table_name="sales_return_batch_allocations")
    op.drop_table("sales_return_batch_allocations")

    op.drop_index(op.f("ix_sales_return_items_id"), table_name="sales_return_items")
    op.drop_table("sales_return_items")

    op.drop_index(op.f("ix_credit_notes_note_number"), table_name="credit_notes")
    op.drop_index(op.f("ix_credit_notes_id"), table_name="credit_notes")
    op.drop_table("credit_notes")

    op.drop_index(op.f("ix_sales_returns_return_number"), table_name="sales_returns")
    op.drop_index(op.f("ix_sales_returns_id"), table_name="sales_returns")
    op.drop_table("sales_returns")

    op.drop_table("supplier_ledger")

    op.drop_column("customer_ledger", "total_credit_notes")
    op.drop_column("customer_ledger", "total_billed")
    op.drop_column("payment_transactions", "is_initial_payment")
    op.drop_column("payment_transactions", "reference_number")
    op.drop_column("stock_adjustments", "final_action")
    op.drop_column("stock_batches", "non_sellable_quantity")
    op.drop_column("products", "non_sellable_stock")
