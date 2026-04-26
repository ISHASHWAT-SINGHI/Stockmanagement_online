from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


# ─── Business Settings ───────────────────────────────────────────────────────
class BusinessSettingsBase(BaseModel):
    company_name: str = "My Business"
    tagline: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    gst_number: Optional[str] = None
    state_code: Optional[str] = None
    pan_number: Optional[str] = None
    invoice_prefix: Optional[str] = "INV"
    invoice_footer: Optional[str] = None
    logo_url: Optional[str] = None

class BusinessSettingsUpdate(BusinessSettingsBase):
    pass

class BusinessSettingsResponse(BusinessSettingsBase):
    id: int
    updated_at: datetime
    class Config:
        from_attributes = True


# ─── Auth & Users ─────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str
    must_change_password: bool = False

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None
    must_change_password: Optional[bool] = False

class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    must_change_password: bool
    created_at: datetime
    class Config:
        from_attributes = True

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

# ─── Supplier ───────────────────────────────────────────────────────────────

class SupplierBase(BaseModel):
    company_name: str
    gst_number: str
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None

class SupplierCreate(SupplierBase):
    pass

class SupplierResponse(SupplierBase):
    id: int
    class Config:
        from_attributes = True


# ─── Product ─────────────────────────────────────────────────────────────────

class ProductBase(BaseModel):
    brand_name: Optional[str] = None
    product_name: str
    packing_type: str = "Unit"
    units_per_pack: int = 1
    current_stock: int = 0

class ProductCreate(ProductBase):
    pass

class ProductResponse(ProductBase):
    id: int
    is_archived: bool
    class Config:
        from_attributes = True


class ProductBulkUnarchiveRequest(BaseModel):
    product_ids: List[int]


# ─── Barcode ─────────────────────────────────────────────────────────────────

class BarcodeBase(BaseModel):
    barcode: str
    product_id: int

class BarcodeCreate(BarcodeBase):
    pass

class BarcodeResponse(BarcodeBase):
    class Config:
        from_attributes = True


# ─── Customer ────────────────────────────────────────────────────────────────

class CustomerBase(BaseModel):
    name: str
    phone: Optional[str] = None
    gst_number: Optional[str] = None
    address: Optional[str] = None

class CustomerCreate(CustomerBase):
    pass

class CustomerResponse(CustomerBase):
    id: int
    class Config:
        from_attributes = True


# ─── Purchase Invoice ────────────────────────────────────────────────────────

class PurchaseItemCreate(BaseModel):
    product_id: int
    quantity: int
    unit_price: float
    gst_percent: float
    line_total: float

class PurchaseItemResponse(PurchaseItemCreate):
    id: int
    invoice_id: int
    class Config:
        from_attributes = True

class PurchaseInvoiceCreate(BaseModel):
    supplier_id: int
    invoice_number: str
    invoice_date: date
    total_amount: float
    items: List[PurchaseItemCreate]

class PurchaseInvoiceResponse(BaseModel):
    id: int
    supplier_id: int
    invoice_number: str
    invoice_date: date
    total_amount: float
    created_at: datetime
    class Config:
        from_attributes = True

class PurchaseInvoiceDetailResponse(PurchaseInvoiceResponse):
    purchase_items: List[PurchaseItemResponse] = []
    class Config:
        from_attributes = True


# ─── Stock Batch ─────────────────────────────────────────────────────────────

class StockBatchCreate(BaseModel):
    product_id: int
    purchase_invoice_id: int
    batch_number: Optional[str] = None
    purchase_price: float
    gst_percentage: float
    initial_quantity: int
    available_quantity: int
    purchase_date: date
    expiry_date: Optional[date] = None

class StockBatchResponse(StockBatchCreate):
    id: int
    class Config:
        from_attributes = True


# ─── Sales Bill ──────────────────────────────────────────────────────────────

class SaleItemCreate(BaseModel):
    product_id: int
    stock_batch_id: int
    quantity: int
    selling_price: float
    gst_percent: float
    discount_percent: float = 0
    final_amount: float

class SaleItemResponse(SaleItemCreate):
    id: int
    bill_id: int
    class Config:
        from_attributes = True

class SalesBillCreate(BaseModel):
    customer_id: Optional[int] = None
    bill_number: str
    subtotal: float
    discount_amount: float = 0
    taxable_amount: float
    cgst_amount: float = 0
    sgst_amount: float = 0
    grand_total: float
    paid_amount: float = 0
    outstanding_amount: float = 0
    payment_status: str = "Pending"
    payment_mode: Optional[str] = None
    items: List[SaleItemCreate]

class SalesBillResponse(BaseModel):
    id: int
    customer_id: Optional[int] = None
    bill_number: str
    bill_date: datetime
    subtotal: float
    discount_amount: float
    taxable_amount: float
    cgst_amount: float
    sgst_amount: float
    grand_total: float
    paid_amount: float
    outstanding_amount: float
    payment_status: str
    payment_mode: Optional[str] = None
    class Config:
        from_attributes = True

class SalesBillDetailResponse(SalesBillResponse):
    sales_items: List[SaleItemResponse] = []
    class Config:
        from_attributes = True


# ─── Payment Transaction ─────────────────────────────────────────────────────

class PaymentTransactionCreate(BaseModel):
    bill_id: int
    customer_id: int
    amount: float
    payment_mode: str
    notes: Optional[str] = None

class PaymentTransactionResponse(PaymentTransactionCreate):
    id: int
    payment_date: datetime
    class Config:
        from_attributes = True


# ─── Customer Ledger ─────────────────────────────────────────────────────────

class CustomerLedgerResponse(BaseModel):
    customer_id: int
    total_credit: float
    total_paid: float
    outstanding_balance: float
    class Config:
        from_attributes = True


# ─── Stock Ledger ────────────────────────────────────────────────────────────

class StockLedgerResponse(BaseModel):
    id: int
    product_id: int
    transaction_type: str
    quantity: int
    transaction_date: datetime
    reference_id: Optional[int] = None
    class Config:
        from_attributes = True


# ─── Stock Adjustment ────────────────────────────────────────────────────────

class StockAdjustmentCreate(BaseModel):
    product_id: int
    stock_batch_id: int
    adjustment_type: str  # DAMAGE, EXPIRY, CORRECTION, RETURN
    quantity: int         # negative = reduction, positive = addition
    reason: Optional[str] = None

class StockAdjustmentResponse(BaseModel):
    id: int
    product_id: int
    stock_batch_id: int
    adjustment_type: str
    quantity: int
    reason: Optional[str] = None
    adjusted_by: str
    previous_stock: int
    new_stock: int
    created_at: datetime
    class Config:
        from_attributes = True
