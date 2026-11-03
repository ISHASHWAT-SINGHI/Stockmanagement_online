"""Add refund mode to sales returns

Revision ID: 91b5d1548229
Revises: 9b7f6c4d2e10
Create Date: 2026-11-03 10:00:00.000000

Additive only: a nullable column, no data rewrite. Existing Refund rows keep refund_mode NULL
and are reported as Cash by the daily ledger.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '91b5d1548229'
down_revision: Union[str, Sequence[str], None] = '9b7f6c4d2e10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sales_returns', sa.Column('refund_mode', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('sales_returns', 'refund_mode')
