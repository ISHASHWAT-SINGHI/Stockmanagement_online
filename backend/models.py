from sqlalchemy import (Column, Integer, String, Float, ForeignKey,
                         DateTime, Date, Text, Boolean, func, UniqueConstraint)
from sqlalchemy.orm import relationship
from database import Base
import datetime


# ─── Utility mixin ────────────────────────────────────────────────────────────
class TimestampMixin:
    """Adds created_at and updated_at to any model."""
    created_at = Column(DateTime, default=datetime.datetime.utcnow, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, server_default=func.now(),
                        onupdate=datetime.datetime.utcnow, nullable=False)


class SoftDeleteMixin:
    """Adds is_deleted for soft-delete pattern."""
    is_deleted = Column(Boolean, default=False, server_default='false', nullable=False, index=True)


# ─── Users ────────────────────────────────────────────────────────────────────
class User(TimestampMixin, Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="viewer")  # admin, billing_staff, viewer
    must_change_password = Column(Boolean, default=False)


# ─── Feature Flags ────────────────────────────────────────────────────────────
class FeatureFlag(Base):
    """Allows gradual feature rollouts without code changes."""
    __tablename__ = "feature_flags"
    id = Column(Integer, primary_key=True, index=True)
    feature_name = Column(String, unique=True, nullable=False, index=True)
    enabled = Column(Boolean, default=False, nullable=False)
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow,
                        onupdate=datetime.datetime.utcnow)


# ─── Business Settings (Singleton) ───────────────────────────────────────────────────
class BusinessSettings(TimestampMixin, Base):
    """Company profile used for invoice letterheads. Only one row should exist."""
    __tablename__ = "business_settings"
    id = Column(Integer, primary_key=True, default=1)  # Always id=1 (singleton)
    company_name = Column(String, nullable=False, default="My Business")
    tagline = Column(String)
    address = Column(Text)
    city = Column(String)
    state = Column(String)
    pincode = Column(String)
    phone = Column(String)
    email = Column(String)
    website = Column(String)
    gst_number = Column(String)
    state_code = Column(String)     # For GST CGST/SGST split logic
    pan_number = Column(String)
    invoice_prefix = Column(String, default="INV")   # e.g. INV → INV/25-26/0001
    invoice_footer = Column(Text)   # Custom note on invoice bottom
    logo_url = Column(String)       # Path or URL to business logo


# ─── Suppliers ────────────────────────────────────────────────────────────────
class Supplier(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "suppliers"
    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String, nullable=False)
    gst_number = Column(String)
    address = Column(String)
    phone = Column(String)
    email = Column(String)

    purchase_invoices = relationship("PurchaseInvoice", back_populates="supplier")


# ─── Products ─────────────────────────────────────────────────────────────────
class Product(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    brand_name = Column(String)
    product_name = Column(String, nullable=False)
    packing_type = Column(String, default="Unit")
    units_per_pack = Column(Integer, default=1)
    current_stock = Column(Integer, default=0)
    is_archived = Column(Boolean, default=False, nullable=False, index=True)

    # Future-proof optional fields (additive — no breaking migrations later)
    hsn_code = Column(String)           # GST HSN code
    unit_type = Column(String)          # e.g. KG, PCS, BOX
    tax_rate = Column(Float)            # default GST %
    category = Column(String)          # product category
    min_stock_level = Column(Integer, default=0)  # low-stock threshold

    barcodes = relationship("Barcode", back_populates="product")
    purchase_items = relationship("PurchaseItem", back_populates="product")
    stock_batches = relationship("StockBatch", back_populates="product")
    sales_items = relationship("SaleItem", back_populates="product")


# ─── Barcodes ─────────────────────────────────────────────────────────────────
class Barcode(Base):
    __tablename__ = "barcodes"
    barcode = Column(String, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"))

    product = relationship("Product", back_populates="barcodes")


# ─── Customers ────────────────────────────────────────────────────────────────
class Customer(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String)
    gst_number = Column(String)
    address = Column(String)

    sales_bills = relationship("SalesBill", back_populates="customer")
    payment_transactions = relationship("PaymentTransaction", back_populates="customer")
    ledger = relationship("CustomerLedger", back_populates="customer", uselist=False)


# ─── Purchase Invoices ────────────────────────────────────────────────────────
class PurchaseInvoice(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "purchase_invoices"
    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"))
    invoice_number = Column(String)
    invoice_date = Column(Date)
    total_amount = Column(Float)

    supplier = relationship("Supplier", back_populates="purchase_invoices")
    purchase_items = relationship("PurchaseItem", back_populates="invoice")
    stock_batches = relationship("StockBatch", back_populates="purchase_invoice")

    @property
    def total_quantity(self):
        return sum((item.quantity or 0) for item in self.purchase_items or [])


# ─── Purchase Items ───────────────────────────────────────────────────────────
class PurchaseItem(Base):
    __tablename__ = "purchase_items"
    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("purchase_invoices.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    quantity = Column(Integer)
    unit_price = Column(Float)
    gst_percent = Column(Float)
    line_total = Column(Float)
    product_name_snapshot = Column(String)

    invoice = relationship("PurchaseInvoice", back_populates="purchase_items")
    product = relationship("Product", back_populates="purchase_items")


# ─── Stock Batches (FIFO) ─────────────────────────────────────────────────────
class StockBatch(Base):
    __tablename__ = "stock_batches"
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    purchase_invoice_id = Column(Integer, ForeignKey("purchase_invoices.id"))
    batch_number = Column(String)
    purchase_price = Column(Float)
    gst_percentage = Column(Float)
    initial_quantity = Column(Integer)
    available_quantity = Column(Integer)
    purchase_date = Column(Date)
    expiry_date = Column(Date)

    product = relationship("Product", back_populates="stock_batches")
    purchase_invoice = relationship("PurchaseInvoice", back_populates="stock_batches")
    sales_items = relationship("SaleItem", back_populates="stock_batch")
    sale_item_allocations = relationship("SaleItemBatchAllocation", back_populates="stock_batch")


# ─── Sales Bills ──────────────────────────────────────────────────────────────
class SalesBill(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "sales_bills"
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"))
    bill_number = Column(String, unique=True)
    bill_date = Column(DateTime, default=datetime.datetime.utcnow)
    subtotal = Column(Float)
    discount_amount = Column(Float, default=0)
    taxable_amount = Column(Float)
    cgst_amount = Column(Float, default=0)
    sgst_amount = Column(Float, default=0)
    grand_total = Column(Float)
    paid_amount = Column(Float, default=0)
    outstanding_amount = Column(Float, default=0)
    payment_status = Column(String, default="Pending")
    payment_mode = Column(String)
    status = Column(String, default="ACTIVE")  # ACTIVE, CANCELLED
    financial_year = Column(String, index=True)
    bill_sequence = Column(Integer, index=True)
    revision_number = Column(Integer, default=1, nullable=False)
    edited_at = Column(DateTime)
    edited_by = Column(String)

    customer = relationship("Customer", back_populates="sales_bills")
    sales_items = relationship("SaleItem", back_populates="bill")
    payment_transactions = relationship("PaymentTransaction", back_populates="bill")

    __table_args__ = (
        UniqueConstraint("financial_year", "bill_sequence", name="uq_sales_bills_financial_year_sequence"),
    )

    @property
    def total_quantity(self):
        return sum((item.quantity or 0) for item in self.sales_items or [])


# ─── Sale Items ───────────────────────────────────────────────────────────────
class SaleItem(Base):
    __tablename__ = "sales_items"
    id = Column(Integer, primary_key=True, index=True)
    bill_id = Column(Integer, ForeignKey("sales_bills.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    stock_batch_id = Column(Integer, ForeignKey("stock_batches.id"))
    quantity = Column(Integer)
    selling_price = Column(Float)
    gst_percent = Column(Float)
    discount_percent = Column(Float, default=0)
    final_amount = Column(Float)
    product_name_snapshot = Column(String)

    bill = relationship("SalesBill", back_populates="sales_items")
    product = relationship("Product", back_populates="sales_items")
    stock_batch = relationship("StockBatch", back_populates="sales_items")
    batch_allocations = relationship("SaleItemBatchAllocation", back_populates="sale_item")


class SaleItemBatchAllocation(Base):
    __tablename__ = "sale_item_batch_allocations"
    id = Column(Integer, primary_key=True, index=True)
    sale_item_id = Column(Integer, ForeignKey("sales_items.id"), nullable=False, index=True)
    stock_batch_id = Column(Integer, ForeignKey("stock_batches.id"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)

    sale_item = relationship("SaleItem", back_populates="batch_allocations")
    stock_batch = relationship("StockBatch", back_populates="sale_item_allocations")


class SalesBillSequence(Base):
    __tablename__ = "sales_bill_sequences"
    financial_year = Column(String, primary_key=True)
    last_number = Column(Integer, nullable=False, default=0)


# ─── Stock Ledger ─────────────────────────────────────────────────────────────
class StockLedger(Base):
    """Append-only. Never update existing rows — only insert."""
    __tablename__ = "stock_ledger"
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    transaction_type = Column(String)  # PURCHASE, SALE, ADJUSTMENT, CREDIT_NOTE
    quantity = Column(Integer)
    transaction_date = Column(DateTime, default=datetime.datetime.utcnow)
    reference_id = Column(Integer)    # Invoice ID or Bill ID
    notes = Column(Text)


# ─── Stock Adjustments ────────────────────────────────────────────────────────
class StockAdjustment(TimestampMixin, Base):
    """Manual stock corrections: damaged goods, expired stock, corrections."""
    __tablename__ = "stock_adjustments"
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    stock_batch_id = Column(Integer, ForeignKey("stock_batches.id"), nullable=False)
    adjustment_type = Column(String, nullable=False)  # DAMAGE, EXPIRY, CORRECTION, RETURN
    quantity = Column(Integer, nullable=False)         # negative = reduction
    reason = Column(Text)
    adjusted_by = Column(String)                      # username
    previous_stock = Column(Integer)
    new_stock = Column(Integer)

    product = relationship("Product")
    stock_batch = relationship("StockBatch")


# ─── Payment Transactions ─────────────────────────────────────────────────────
class PaymentTransaction(Base):
    __tablename__ = "payment_transactions"
    id = Column(Integer, primary_key=True, index=True)
    bill_id = Column(Integer, ForeignKey("sales_bills.id"))
    customer_id = Column(Integer, ForeignKey("customers.id"))
    amount = Column(Float, nullable=False)
    payment_mode = Column(String, nullable=False)
    payment_date = Column(DateTime, default=datetime.datetime.utcnow)
    notes = Column(Text)

    bill = relationship("SalesBill", back_populates="payment_transactions")
    customer = relationship("Customer", back_populates="payment_transactions")


# ─── Customer Ledger ──────────────────────────────────────────────────────────
class CustomerLedger(Base):
    """Append-only summary. For detailed history use payment_transactions."""
    __tablename__ = "customer_ledger"
    customer_id = Column(Integer, ForeignKey("customers.id"), primary_key=True)
    total_credit = Column(Float, default=0)
    total_paid = Column(Float, default=0)
    outstanding_balance = Column(Float, default=0)

    customer = relationship("Customer", back_populates="ledger")
