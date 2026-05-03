"""Add client request id to purchase invoices

Revision ID: f4b9c7d2a1e0
Revises: a3d4b2c1e5f6
Create Date: 2026-05-03 15:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4b9c7d2a1e0'
down_revision: Union[str, Sequence[str], None] = 'a3d4b2c1e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('purchase_invoices', sa.Column('client_request_id', sa.String(), nullable=True))
    op.create_index(
        op.f('ix_purchase_invoices_client_request_id'),
        'purchase_invoices',
        ['client_request_id'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_purchase_invoices_client_request_id'), table_name='purchase_invoices')
    op.drop_column('purchase_invoices', 'client_request_id')
