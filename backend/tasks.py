import asyncio
import datetime
from sqlalchemy.future import select
from sqlalchemy import or_, and_, text
from database import SessionLocal
import models
import logging

logger = logging.getLogger(__name__)

async def auto_archive_products():
    """Archives products with 0 stock and no activity in 60 days."""
    while True:
        try:
            async with SessionLocal() as db:
                sixty_days_ago = datetime.datetime.utcnow() - datetime.timedelta(days=60)
                
                # Find products with exactly 0 stock, not deleted, not archived
                result = await db.execute(
                    select(models.Product).where(
                        models.Product.current_stock == 0,
                        models.Product.is_deleted == False,
                        models.Product.is_archived == False
                    )
                )
                products_to_check = result.scalars().all()
                
                archived_count = 0
                for product in products_to_check:
                    # Check recent stock ledger entries
                    ledger_res = await db.execute(
                        select(models.StockLedger).where(
                            models.StockLedger.product_id == product.id,
                            models.StockLedger.transaction_date >= sixty_days_ago
                        ).limit(1)
                    )
                    recent_activity = ledger_res.scalar_one_or_none()
                    
                    if not recent_activity:
                        product.is_archived = True
                        archived_count += 1
                
                if archived_count > 0:
                    await db.commit()
                    logger.info(f"Auto-archived {archived_count} products.")
                    
        except Exception as e:
            logger.error(f"Error in auto_archive_products task: {e}")
            
        # Run once a day (86400 seconds)
        await asyncio.sleep(86400)
