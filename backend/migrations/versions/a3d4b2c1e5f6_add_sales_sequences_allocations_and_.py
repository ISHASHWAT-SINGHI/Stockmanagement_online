"""Add sales sequences, allocations, revisions, and product snapshots

Revision ID: a3d4b2c1e5f6
Revises: 2e1ff04195dc
Create Date: 2026-05-03 13:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3d4b2c1e5f6'
down_revision: Union[str, Sequence[str], None] = '2e1ff04195dc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('purchase_items', sa.Column('product_name_snapshot', sa.String(), nullable=True))

    op.add_column('sales_bills', sa.Column('financial_year', sa.String(), nullable=True))
    op.add_column('sales_bills', sa.Column('bill_sequence', sa.Integer(), nullable=True))
    op.add_column('sales_bills', sa.Column('revision_number', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('sales_bills', sa.Column('edited_at', sa.DateTime(), nullable=True))
    op.add_column('sales_bills', sa.Column('edited_by', sa.String(), nullable=True))
    op.create_index(op.f('ix_sales_bills_financial_year'), 'sales_bills', ['financial_year'], unique=False)
    op.create_index(op.f('ix_sales_bills_bill_sequence'), 'sales_bills', ['bill_sequence'], unique=False)

    op.add_column('sales_items', sa.Column('product_name_snapshot', sa.String(), nullable=True))

    op.create_table(
        'sale_item_batch_allocations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('sale_item_id', sa.Integer(), nullable=False),
        sa.Column('stock_batch_id', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['sale_item_id'], ['sales_items.id']),
        sa.ForeignKeyConstraint(['stock_batch_id'], ['stock_batches.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_sale_item_batch_allocations_id'), 'sale_item_batch_allocations', ['id'], unique=False)
    op.create_index(op.f('ix_sale_item_batch_allocations_sale_item_id'), 'sale_item_batch_allocations', ['sale_item_id'], unique=False)
    op.create_index(op.f('ix_sale_item_batch_allocations_stock_batch_id'), 'sale_item_batch_allocations', ['stock_batch_id'], unique=False)

    op.create_table(
        'sales_bill_sequences',
        sa.Column('financial_year', sa.String(), nullable=False),
        sa.Column('last_number', sa.Integer(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('financial_year')
    )

    op.execute("""
        UPDATE purchase_items AS pi
        SET product_name_snapshot = TRIM(CONCAT(COALESCE(p.brand_name || ' ', ''), COALESCE(p.product_name, '')))
        FROM products AS p
        WHERE p.id = pi.product_id
          AND (pi.product_name_snapshot IS NULL OR pi.product_name_snapshot = '');
    """)

    op.execute("""
        UPDATE sales_items AS si
        SET product_name_snapshot = TRIM(CONCAT(COALESCE(p.brand_name || ' ', ''), COALESCE(p.product_name, '')))
        FROM products AS p
        WHERE p.id = si.product_id
          AND (si.product_name_snapshot IS NULL OR si.product_name_snapshot = '');
    """)

    op.execute("""
        WITH numbered AS (
            SELECT
                id,
                CASE
                    WHEN EXTRACT(MONTH FROM bill_date) >= 4
                        THEN TO_CHAR(bill_date, 'YY') || '-' || TO_CHAR(bill_date + INTERVAL '1 year', 'YY')
                    ELSE
                        TO_CHAR(bill_date - INTERVAL '1 year', 'YY') || '-' || TO_CHAR(bill_date, 'YY')
                END AS fy,
                ROW_NUMBER() OVER (
                    PARTITION BY CASE
                        WHEN EXTRACT(MONTH FROM bill_date) >= 4
                            THEN TO_CHAR(bill_date, 'YY') || '-' || TO_CHAR(bill_date + INTERVAL '1 year', 'YY')
                        ELSE
                            TO_CHAR(bill_date - INTERVAL '1 year', 'YY') || '-' || TO_CHAR(bill_date, 'YY')
                    END
                    ORDER BY bill_date, id
                ) AS seq
            FROM sales_bills
        )
        UPDATE sales_bills AS sb
        SET financial_year = numbered.fy,
            bill_sequence = numbered.seq
        FROM numbered
        WHERE sb.id = numbered.id;
    """)

    op.execute("""
        INSERT INTO sales_bill_sequences (financial_year, last_number)
        SELECT financial_year, MAX(bill_sequence)
        FROM sales_bills
        WHERE financial_year IS NOT NULL
          AND bill_sequence IS NOT NULL
        GROUP BY financial_year;
    """)

    op.create_unique_constraint(
        'uq_sales_bills_financial_year_sequence',
        'sales_bills',
        ['financial_year', 'bill_sequence'],
    )

    op.alter_column('sales_bills', 'revision_number', server_default=None)


def downgrade() -> None:
    op.drop_constraint('uq_sales_bills_financial_year_sequence', 'sales_bills', type_='unique')

    op.drop_table('sales_bill_sequences')

    op.drop_index(op.f('ix_sale_item_batch_allocations_stock_batch_id'), table_name='sale_item_batch_allocations')
    op.drop_index(op.f('ix_sale_item_batch_allocations_sale_item_id'), table_name='sale_item_batch_allocations')
    op.drop_index(op.f('ix_sale_item_batch_allocations_id'), table_name='sale_item_batch_allocations')
    op.drop_table('sale_item_batch_allocations')

    op.drop_column('sales_items', 'product_name_snapshot')

    op.drop_index(op.f('ix_sales_bills_bill_sequence'), table_name='sales_bills')
    op.drop_index(op.f('ix_sales_bills_financial_year'), table_name='sales_bills')
    op.drop_column('sales_bills', 'edited_by')
    op.drop_column('sales_bills', 'edited_at')
    op.drop_column('sales_bills', 'revision_number')
    op.drop_column('sales_bills', 'bill_sequence')
    op.drop_column('sales_bills', 'financial_year')

    op.drop_column('purchase_items', 'product_name_snapshot')
