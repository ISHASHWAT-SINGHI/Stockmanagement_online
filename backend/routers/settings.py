"""routers/settings.py — Business profile / settings endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

import models
import schemas
from database import get_db
from security import get_current_user

router = APIRouter(prefix="/api/v1", tags=["settings"], dependencies=[Depends(get_current_user)])


@router.get("/settings/business", response_model=schemas.BusinessSettingsResponse)
async def get_business_settings(db: AsyncSession = Depends(get_db)):
    """Return the singleton business settings row (id=1). Creates a default one if missing."""
    result = await db.execute(select(models.BusinessSettings).where(models.BusinessSettings.id == 1))
    settings = result.scalar_one_or_none()
    if not settings:
        settings = models.BusinessSettings(id=1, company_name="My Business", invoice_prefix="INV")
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
    return settings


@router.put("/settings/business", response_model=schemas.BusinessSettingsResponse)
async def update_business_settings(
    data: schemas.BusinessSettingsUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Upsert the singleton business settings row (id=1)."""
    result = await db.execute(select(models.BusinessSettings).where(models.BusinessSettings.id == 1))
    settings = result.scalar_one_or_none()

    if settings:
        for key, value in data.model_dump(exclude_unset=False).items():
            setattr(settings, key, value)
    else:
        settings = models.BusinessSettings(id=1, **data.model_dump())
        db.add(settings)

    await db.commit()
    await db.refresh(settings)
    return settings
