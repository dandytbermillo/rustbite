export type Badge = "NEW" | "POPULAR" | "DEAL" | "HOT" | null;
export type ImageFit = "COVER" | "CONTAIN";
export type MenuStockMode = "MANUAL" | "QUANTITY";
export type DealLimitMode = "UNLIMITED" | "LIMITED";

export type Modifier = {
  id: string;
  name: string;
  price: number;
};

export type AddOnSetCartSelection = {
  itemLinkId: string;
  groupId: string;
  name: string;
  options: Modifier[];
};

export type ModifierOption = {
  id: string;
  name: string;
  priceDelta: number;
};

export type AddOnSetSelectionMode =
  | "OPTIONAL_MULTI"
  | "REQUIRED_SINGLE"
  | "OPTIONAL_SINGLE"
  | "REQUIRED_MULTI";

export type AddOnSetOptionDTO = {
  id: string;
  groupId: string;
  name: string;
  priceDelta: number;
  isAvailable: boolean;
  unavailableReason: "OUT_OF_STOCK" | "HIDDEN" | null;
  quantityLabel: string | null;
  sortOrder: number;
};

export type AddOnSetDTO = {
  itemLinkId: string;
  groupId: string;
  name: string;
  displayRuleText: string;
  selectionMode: AddOnSetSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  isRequired: boolean;
  isSatisfiable: boolean;
  sortOrder: number;
  options: AddOnSetOptionDTO[];
};

export type UpgradeLinkedItemDTO = {
  id: string;
  menuItemId: string | null;
  sizeId: string | null;
  nameSnapshot: string;
  sizeName: string | null;
  price: number;
  emoji: string;
  bgColor: string;
};

export type UpgradeOptionDTO = {
  id: string;
  customTitle: string | null;
  extraCharge: number;
  savingsLabel: number | null;
  linkedItems: UpgradeLinkedItemDTO[];
};

export type UpgradeSnapshotLink = {
  id: string;
  menuItemId: string | null;
  sizeId: string | null;
  nameSnapshot: string;
  sizeName: string | null;
  price: number;
};

export type UpgradeSnapshot = {
  id: string;
  customTitle: string | null;
  titleSnapshot: string;
  extraCharge: number;
  savingsLabel: number | null;
  linkedItems: UpgradeSnapshotLink[];
};

export type StockRequirementSource =
  | "NORMAL_ITEM"
  | "DEAL_BASE_ITEM"
  | "DEAL_INCLUDED_ITEM"
  | "ITEM_LOCAL_ADDON"
  | "SHARED_MODIFIER_OPTION";

export type StockRequirementTargetType =
  | "MENU_ITEM"
  | "ITEM_LOCAL_ADDON"
  | "SHARED_MODIFIER_OPTION";

export type StockRequirementSnapshot = {
  targetType: StockRequirementTargetType;
  targetId: string;
  targetNameSnapshot: string;
  qty: number;
  source: StockRequirementSource;
  orderLineMenuItemId: string;
  menuItemId?: string | null;
  addonOptionId?: string | null;
  sharedModifierOptionId?: string | null;
  upgradeOptionId?: string | null;
  upgradeItemLinkId?: string | null;
};

export type MenuItemDTO = {
  id: string;
  categoryId: string;
  comboNum: number | null;
  name: string;
  description: string;
  price: number;
  emoji: string;
  bgColor: string;
  badge: Badge;
  bundleSavings: number | null;
  imageUrl: string | null;
  imageAlt: string | null;
  imageFit: ImageFit;
  cardImageUrl: string | null;
  cardImageAlt: string | null;
  stockMode: MenuStockMode;
  stockQty: number | null;
  lowStockThreshold: number | null;
  dealLimitMode?: DealLimitMode;
  dealLimitQty?: number | null;
  dealLimitLowThreshold?: number | null;
  dealLimitSoldOut?: boolean;
  isOutOfStock: boolean;
  sizes: ModifierOption[];
  addons: ModifierOption[];
  addOnSets: AddOnSetDTO[];
  upgradeOptions: UpgradeOptionDTO[];
};

export type CategoryDTO = {
  id: string;
  slug: string;
  name: string;
  icon: string;
};

export type CartItemState = {
  lineId: string;
  item: MenuItemDTO;
  size: Modifier | null;
  addons: Modifier[];
  addOnSetSelections: AddOnSetCartSelection[];
  selectedUpgradeOptionId: string | null;
  selectedUpgradeSnapshot: UpgradeSnapshot | null;
  qty: number;
};

export type OrderStatus =
  | "AWAITING_COUNTER_PAYMENT"
  | "PAID"
  | "IN_KITCHEN"
  | "READY"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUNDED";

export type OrderType = "DINE_IN" | "TAKEOUT";
export type PaymentMethod = "CARD" | "MOBILE" | "CASH";
export type PaymentProvider = "COUNTER" | "MOCK" | "STRIPE_TERMINAL";
export type PaymentTransactionStatus =
  | "CREATED"
  | "PROCESSING"
  | "PENDING_COUNTER_PAYMENT"
  | "AUTHORIZED"
  | "CAPTURED"
  | "REFUNDED"
  | "FAILED"
  | "CANCELLED";

export type CheckoutItemInput = {
  menuItemId: string;
  qty: number;
  sizeId?: string | null;
  addonIds?: string[];
  addOnSetSelections?: Array<{
    itemLinkId: string;
    optionIds: string[];
  }>;
  selectedUpgradeOptionId?: string | null;
};

export type CheckoutRequestInput = {
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  expectedTotal: number;
  items: CheckoutItemInput[];
};

export type CheckoutLineSnapshot = {
  lineKind: "ITEM" | "DEAL";
  menuItemId: string;
  nameSnapshot: string;
  qty: number;
  sizeId: string | null;
  sizeName: string | null;
  sizePriceDelta: number | null;
  addonIds: string[];
  addons: Array<{ name: string; priceDelta: number }>;
  addOnSetSelections: Array<{
    itemLinkId: string;
    groupId: string;
    name: string;
    options: Array<{ id: string; name: string; priceDelta: number }>;
  }>;
  selectedUpgradeOptionId: string | null;
  selectedUpgradeSnapshot: UpgradeSnapshot | null;
  lineTotal: number;
};

export type CheckoutSnapshot = {
  kioskId: string;
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  subtotal: number;
  gst: number;
  total: number;
  items: CheckoutLineSnapshot[];
  stockRequirements?: StockRequirementSnapshot[];
};

export type PaymentSessionSummary = {
  id: string;
  provider: PaymentProvider;
  status: PaymentTransactionStatus;
  paymentMethod: PaymentMethod;
  currency: string;
  subtotal: number;
  gst: number;
  total: number;
  failureCode: string | null;
  failureMessage: string | null;
  orderId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaymentSessionErrorCode =
  | "MENU_ITEM_UNAVAILABLE"
  | "MENU_MODIFIER_INVALID"
  | "MENU_TOTAL_MISMATCH"
  | "MENU_STOCK_UNAVAILABLE"
  | "MENU_STOCK_EXTERNAL_PAYMENT_UNSUPPORTED"
  | "STALE_CART";

export type StockUnavailableResponseItem = {
  targetType?: StockRequirementTargetType | "DEAL_LIMIT";
  targetId?: string;
  targetNameSnapshot?: string;
  requestedQty: number;
  availableQty: number;
  menuItemId?: string | null;
  nameSnapshot?: string;
};

export type PaymentSessionErrorResponse = {
  error: string;
  errorCode?: PaymentSessionErrorCode;
  failureMessage?: string;
  items?: StockUnavailableResponseItem[];
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  orderType: OrderType;
  status: OrderStatus;
  subtotal: number;
  gst: number;
  total: number;
  paymentMethod: PaymentMethod | null;
  paymentProvider: PaymentProvider | null;
  paymentStatus: PaymentTransactionStatus | null;
  paymentTransactionId?: string | null;
  paymentReference?: string | null;
  paymentFailureMessage?: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    nameSnapshot: string;
    qty: number;
    sizeName: string | null;
    isMeal: boolean;
    addonsJson: Array<{ name: string; priceDelta: number }>;
    upgradeSnapshotJson: UpgradeSnapshot | null;
    lineTotal: number;
  }>;
};
