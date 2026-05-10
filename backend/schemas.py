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
    non_sellable_stock: int = 0
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
    product_name_snapshot: Optional[str] = None
    product: Optional[ProductResponse] = None
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
    total_quantity: int = 0
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
    non_sellable_quantity: int = 0
    class Config:
        from_attributes = True


# ─── Sales Bill ──────────────────────────────────────────────────────────────

class SaleItemCreate(BaseModel):
    product_id: int
    quantity: int
    selling_price: float
    gst_percent: float
    discount_percent: float = 0
    final_amount: float
    stock_batch_id: Optional[int] = None


class SaleItemBatchAllocationResponse(BaseModel):
    id: int
    stock_batch_id: int
    quantity: int
    class Config:
        from_attributes = True

class SaleItemResponse(SaleItemCreate):
    id: int
    bill_id: int
    product_name_snapshot: Optional[str] = None
    product: Optional[ProductResponse] = None
    batch_allocations: List[SaleItemBatchAllocationResponse] = []
    class Config:
        from_attributes = True

class SalesBillCreate(BaseModel):
    customer_id: Optional[int] = None
    bill_number: Optional[str] = None
    bill_date: Optional[date] = None
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
    payment_note: Optional[str] = None
    payment_reference: Optional[str] = None
    items: List[SaleItemCreate]

class SalesBillResponse(BaseModel):
    id: int
    customer_id: Optional[int] = None
    customer: Optional[CustomerResponse] = None
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
    financial_year: Optional[str] = None
    bill_sequence: Optional[int] = None
    revision_number: int = 1
    edited_at: Optional[datetime] = None
    edited_by: Optional[str] = None
    total_quantity: int = 0
    class Config:
        from_attributes = True

class SalesBillDetailResponse(SalesBillResponse):
    sales_items: List[SaleItemResponse] = []
    customer: Optional[CustomerResponse] = None
    payment_transactions: List["PaymentTransactionResponse"] = []
    class Config:
        from_attributes = True


# ─── Payment Transaction ─────────────────────────────────────────────────────

class PaymentTransactionCreate(BaseModel):
    bill_id: int
    customer_id: Optional[int] = None
    amount: float
    payment_mode: str
    payment_date: Optional[datetime] = None
    notes: Optional[str] = None
    reference_number: Optional[str] = None

class PaymentTransactionResponse(PaymentTransactionCreate):
    id: int
    is_initial_payment: bool = False
    payment_date: datetime
    class Config:
        from_attributes = True


# ─── Customer Ledger ─────────────────────────────────────────────────────────

class CustomerLedgerResponse(BaseModel):
    customer_id: int
    total_credit: float
    total_billed: float = 0
    total_paid: float
    total_credit_notes: float = 0
    outstanding_balance: float
    bills: List["CustomerLedgerBillHistory"] = []
    payments: List[PaymentTransactionResponse] = []
    credit_notes: List["CreditNoteResponse"] = []
    sales_returns: List["SalesReturnResponse"] = []
    class Config:
        from_attributes = True


class CustomerLedgerOverviewRow(BaseModel):
    customer_id: int
    customer_name: str
    phone: Optional[str] = None
    gst_number: Optional[str] = None
    total_credit: float = 0
    total_billed: float = 0
    total_paid: float = 0
    total_credit_notes: float = 0
    outstanding_balance: float = 0


class CustomerLedgerOverviewResponse(BaseModel):
    items: List["CustomerLedgerOverviewRow"] = []
    total_outstanding_receivable: float = 0
    total_customers: int = 0


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
    final_action: Optional[str] = "Adjusted"

class StockAdjustmentResponse(BaseModel):
    id: int
    product_id: int
    stock_batch_id: int
    adjustment_type: str
    quantity: int
    reason: Optional[str] = None
    adjusted_by: str
    final_action: Optional[str] = None
    previous_stock: int
    new_stock: int
    created_at: datetime
    class Config:
        from_attributes = True


class CustomerLedgerBillHistory(BaseModel):
    id: int
    bill_number: str
    bill_date: datetime
    grand_total: float
    paid_amount: float
    outstanding_amount: float
    payment_status: str
    payment_mode: Optional[str] = None
    class Config:
        from_attributes = True


class SupplierLedgerInvoiceHistory(BaseModel):
    id: int
    invoice_number: str
    invoice_date: date
    total_amount: float
    class Config:
        from_attributes = True


class SupplierPaymentTransactionCreate(BaseModel):
    supplier_id: int
    amount: float
    payment_mode: str
    payment_date: Optional[datetime] = None
    notes: Optional[str] = None
    reference_number: Optional[str] = None


class SupplierPaymentTransactionResponse(SupplierPaymentTransactionCreate):
    id: int
    payment_date: datetime
    class Config:
        from_attributes = True


class SupplierLedgerResponse(BaseModel):
    supplier_id: int
    total_purchases: float
    total_paid: float
    total_returns: float
    outstanding_balance: float
    invoices: List[SupplierLedgerInvoiceHistory] = []
    payments: List[SupplierPaymentTransactionResponse] = []
    stock_returns: List["SupplierStockReturnResponse"] = []
    class Config:
        from_attributes = True


class SupplierLedgerOverviewRow(BaseModel):
    supplier_id: int
    company_name: str
    phone: Optional[str] = None
    gst_number: Optional[str] = None
    total_purchases: float = 0
    total_paid: float = 0
    total_returns: float = 0
    outstanding_balance: float = 0


class SupplierLedgerOverviewResponse(BaseModel):
    items: List["SupplierLedgerOverviewRow"] = []
    total_outstanding_payable: float = 0
    total_suppliers: int = 0


class AccountingSummaryResponse(BaseModel):
    total_customer_receivable: float = 0
    total_supplier_payable: float = 0
    net_position: float = 0


class CreditNoteCreate(BaseModel):
    bill_id: Optional[int] = None
    customer_id: Optional[int] = None
    sales_return_id: Optional[int] = None
    amount: float
    reason: str
    credit_date: Optional[date] = None


class CreditNoteResponse(BaseModel):
    id: int
    note_number: Optional[str] = None
    bill_id: Optional[int] = None
    customer_id: Optional[int] = None
    sales_return_id: Optional[int] = None
    amount: float
    applied_amount: float = 0
    reason: str
    credit_date: datetime
    status: str
    created_at: datetime
    class Config:
        from_attributes = True


class SalesReturnItemCreate(BaseModel):
    sale_item_id: int
    product_id: int
    quantity: int
    amount: float
    stock_action: str = "SELLABLE"
    reason: str


class SalesReturnItemResponse(SalesReturnItemCreate):
    id: int
    product_name_snapshot: Optional[str] = None
    class Config:
        from_attributes = True


class SalesReturnCreate(BaseModel):
    bill_id: int
    customer_id: Optional[int] = None
    return_date: Optional[date] = None
    reason: str
    settlement_type: str = "Credit Note"
    notes: Optional[str] = None
    items: List[SalesReturnItemCreate]


class SalesReturnResponse(BaseModel):
    id: int
    return_number: Optional[str] = None
    bill_id: int
    customer_id: Optional[int] = None
    return_date: datetime
    reason: str
    settlement_type: str
    total_amount: float = 0
    applied_outstanding_amount: float = 0
    refund_amount: float
    credit_note_amount: float
    status: str
    notes: Optional[str] = None
    items: List[SalesReturnItemResponse] = []
    class Config:
        from_attributes = True


class SupplierStockReturnItemCreate(BaseModel):
    product_id: int
    stock_batch_id: Optional[int] = None
    quantity: int
    amount: float = 0
    stock_source: str = "SELLABLE"
    reason: str


class SupplierStockReturnItemResponse(SupplierStockReturnItemCreate):
    id: int
    product_name_snapshot: Optional[str] = None
    batch_number_snapshot: Optional[str] = None
    class Config:
        from_attributes = True


class SupplierStockReturnCreate(BaseModel):
    supplier_id: int
    return_date: Optional[date] = None
    reason: str
    status: str = "Pending"
    credit_amount: float = 0
    notes: Optional[str] = None
    items: List[SupplierStockReturnItemCreate]


class SupplierStockReturnUpdate(BaseModel):
    status: str
    credit_amount: float = 0
    notes: Optional[str] = None


class SupplierStockReturnResponse(BaseModel):
    id: int
    return_number: Optional[str] = None
    supplier_id: int
    return_date: datetime
    reason: str
    status: str
    credit_amount: float
    notes: Optional[str] = None
    items: List[SupplierStockReturnItemResponse] = []
    class Config:
        from_attributes = True


class DailyLedgerResponse(BaseModel):
    ledger_date: date
    cash_sales: float
    upi_sales: float
    card_sales: float
    credit_sales: float
    purchase_payments: float
    sales_returns: float
    stock_return_credit: float
    total_collection: float
    total_outstanding: float


SalesBillDetailResponse.model_rebuild()
CustomerLedgerResponse.model_rebuild()
SupplierLedgerResponse.model_rebuild()
