import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_SIZES,
  FALLBACK_IMAGE,
  defaultProducts,
  defaultReviews,
  getExpirationStatus,
  getNextNumber,
  parseSizes,
  roundCurrency,
  safeParseStorage,
  tryJsonFetch,
} from './data/defaults';
import { supabase } from './lib/supabase';
import type {
  CartItem,
  CurrentUser,
  Customer,
  InventoryTab,
  Order,
  OrderItem,
  PageId,
  PosCartItem,
  Product,
  ProductDetail,
  Review,
  Role,
  Supplier,
} from './types';

function loadInitialProducts(): Product[] {
  const savedProducts = safeParseStorage<Product[] | null>('hvlnProducts', null);
  const savedDefaultSnapshot = safeParseStorage<Product[] | null>(
    'hvlnDefaultProductsSnapshot',
    null
  );

  let mergedProducts: Product[] = defaultProducts.map((p) => ({ ...p }));

  if (Array.isArray(savedProducts) && savedProducts.length > 0) {
    mergedProducts = defaultProducts.map((def) => {
      const saved = savedProducts.find((p) => Number(p.id) === Number(def.id));
      if (!saved) return { ...def };

      const oldDef = Array.isArray(savedDefaultSnapshot)
        ? savedDefaultSnapshot.find((p) => Number(p.id) === Number(def.id))
        : null;

      const merged: Product = {
        ...def,
        ...saved,
        id: Number(def.id),
        price: Number(saved.price ?? def.price),
        stock: Number(saved.stock ?? def.stock),
      };

      if (oldDef) {
        if (Number(saved.price) === Number(oldDef.price)) merged.price = def.price;
        if (saved.image === oldDef.image) merged.image = def.image;
        if (saved.name === oldDef.name) merged.name = def.name;
        if (saved.category === oldDef.category) merged.category = def.category;
        if (saved.description === oldDef.description) merged.description = def.description;
      }

      return merged;
    });

    const defaultIds = new Set(defaultProducts.map((p) => Number(p.id)));
    const extraSaved = savedProducts.filter((p) => !defaultIds.has(Number(p.id)));
    if (extraSaved.length > 0) {
      mergedProducts = [
        ...mergedProducts,
        ...extraSaved.map((p) => ({
          ...p,
          id: Number(p.id),
          price: Number(p.price) || 0,
          stock: Number(p.stock) || 0,
        })),
      ];
    }
  }

  try {
    localStorage.setItem(
      'hvlnDefaultProductsSnapshot',
      JSON.stringify(defaultProducts)
    );
  } catch {
    // Ignore storage quota errors
  }

  return mergedProducts;
}

function loadInitialInventory(productsList: Product[]): Record<number, number> {
  const savedInventory = safeParseStorage<Record<string, number>>('hvlnInventory', {});
  const map: Record<number, number> = {};
  productsList.forEach((product) => {
    const savedVal = savedInventory[String(product.id)];
    if (savedVal !== undefined && Number.isFinite(Number(savedVal))) {
      map[product.id] = Math.max(0, Number(savedVal));
    } else {
      map[product.id] = Math.max(0, Number(product.stock) || 0);
    }
  });
  return map;
}

function loadInitialProductDetails(
  productsList: Product[]
): Record<number, ProductDetail> {
  const savedDetails = safeParseStorage<Record<string, ProductDetail>>(
    'hvlnProductDetails',
    {}
  );
  const map: Record<number, ProductDetail> = {};
  productsList.forEach((product) => {
    const existing = savedDetails[String(product.id)];
    map[product.id] = {
      supplierId: existing?.supplierId ? String(existing.supplierId) : '',
      expirationDate: existing?.expirationDate ? String(existing.expirationDate) : '',
    };
  });
  return map;
}

function getCartQtyForProduct(cartList: CartItem[], productId: number): number {
  return cartList.reduce(
    (sum, item) => (item.productId === productId ? sum + Number(item.quantity) : sum),
    0
  );
}

interface DialogState {
  open: boolean;
  title: string;
  message: string;
  isConfirm: boolean;
  onConfirm?: () => void;
}

export default function App() {
  const [initialData] = useState(() => {
    const prods = loadInitialProducts();
    const inv = loadInitialInventory(prods);
    const syncedProds = prods.map((p) => ({
      ...p,
      stock: inv[p.id] ?? p.stock,
    }));
    const details = loadInitialProductDetails(syncedProds);
    return {
      products: syncedProds,
      inventory: inv,
      productDetails: details,
    };
  });

  const [products, setProducts] = useState<Product[]>(initialData.products);
  const [inventory, setInventory] = useState<Record<number, number>>(
    initialData.inventory
  );
  const [productDetails, setProductDetails] = useState<Record<number, ProductDetail>>(
    initialData.productDetails
  );
  const [cart, setCart] = useState<CartItem[]>(() =>
    safeParseStorage<CartItem[]>('hvlnCart', [])
  );
  const [orders, setOrders] = useState<Order[]>(() =>
    safeParseStorage<Order[]>('hvlnOrders', [])
  );
  const [customers, setCustomers] = useState<Customer[]>(() =>
    safeParseStorage<Customer[]>('hvlnCustomers', [])
  );
  const [suppliers, setSuppliers] = useState<Supplier[]>(() =>
    safeParseStorage<Supplier[]>('hvlnSuppliers', [])
  );
  const [reviews, setReviews] = useState<Review[]>(() =>
    safeParseStorage<Review[]>('hvlnReviews', defaultReviews)
  );
  const [currentUser, setCurrentUser] = useState<CurrentUser>(() =>
    safeParseStorage<CurrentUser>('hvlnCurrentUser', null)
  );
  const [currentRole, setCurrentRole] = useState<Role>(() => {
    try {
      const stored = localStorage.getItem('hvlnCurrentRole');
      return stored === 'customer' || stored === 'owner' ? stored : null;
    } catch {
      return null;
    }
  });

  const [posCart, setPosCart] = useState<PosCartItem[]>([]);
  const [activePage, setActivePage] = useState<PageId>(() => {
    try {
      const stored = localStorage.getItem('hvlnCurrentRole');
      return stored === 'owner' ? 'inventory' : 'home';
    } catch {
      return 'home';
    }
  });
  const [activeInventoryTab, setActiveInventoryTab] =
    useState<InventoryTab>('productList');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selectedSizes, setSelectedSizes] = useState<Record<number, string>>({});

  // Modals visibility
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [showOwnerLoginModal, setShowOwnerLoginModal] = useState(false);
  const [showCartModal, setShowCartModal] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showPosCheckoutModal, setShowPosCheckoutModal] = useState(false);

  // Dialog modal (replaces window.alert & window.confirm safely inside iframes)
  const [dialog, setDialog] = useState<DialogState>({
    open: false,
    title: 'HVLN Shop',
    message: '',
    isConfirm: false,
  });

  // Login form state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginMessage, setLoginMessage] = useState('');

  // Signup form state
  const [signupName, setSignupName] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupContact, setSignupContact] = useState('');
  const [signupAddress, setSignupAddress] = useState('');
  const [signupMessage, setSignupMessage] = useState('');

  // Owner login state
  const [ownerUsername, setOwnerUsername] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerLoginMessage, setOwnerLoginMessage] = useState('');
  const [authLoginMode, setAuthLoginMode] = useState<'customer' | 'owner'>('customer');

  // Checkout form state
  const [checkoutName, setCheckoutName] = useState('');
  const [checkoutContact, setCheckoutContact] = useState('');
  const [checkoutEmail, setCheckoutEmail] = useState('');
  const [checkoutAddress, setCheckoutAddress] = useState('');
  const [checkoutPayment, setCheckoutPayment] = useState('');

  // Inventory editor state
  const [selectedInventoryProductId, setSelectedInventoryProductId] = useState<
    number | null
  >(null);
  const [editProductTitle, setEditProductTitle] = useState('');
  const [editProductName, setEditProductName] = useState('');
  const [editProductPrice, setEditProductPrice] = useState('');
  const [editProductImage, setEditProductImage] = useState('');
  const [editProductSizes, setEditProductSizes] = useState('');
  const [editProductStock, setEditProductStock] = useState('');
  const [editProductSupplier, setEditProductSupplier] = useState('');
  const [editProductExpiration, setEditProductExpiration] = useState('');

  // Supplier form state
  const [supplierName, setSupplierName] = useState('');
  const [supplierContact, setSupplierContact] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');

  // Return modal state
  const [selectedReturnOrderId, setSelectedReturnOrderId] = useState<string | null>(
    null
  );
  const [returnReason, setReturnReason] = useState('');

  // Review form state
  const [reviewRating, setReviewRating] = useState('5');
  const [reviewComment, setReviewComment] = useState('');

  // POS Customer checkout modal state (replaces blocked window.prompt)
  const [posBuyerName, setPosBuyerName] = useState('');
  const [posBuyerContact, setPosBuyerContact] = useState('');
  const [posBuyerEmail, setPosBuyerEmail] = useState('');
  const [posBuyerAddress, setPosBuyerAddress] = useState('');

  const isLoggedIn =
    (currentRole === 'customer' || currentRole === 'owner') && currentUser !== null;

  const showAlert = (message: string, title = 'HVLN Shop') => {
    setDialog({
      open: true,
      title,
      message,
      isConfirm: false,
    });
  };

  const showConfirm = (
    message: string,
    onConfirm: () => void,
    title = 'Confirm Action'
  ) => {
    setDialog({
      open: true,
      title,
      message,
      isConfirm: true,
      onConfirm,
    });
  };

  // Persist data to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('hvlnProducts', JSON.stringify(products));
      localStorage.setItem('hvlnCart', JSON.stringify(cart));
      localStorage.setItem('hvlnOrders', JSON.stringify(orders));
      localStorage.setItem('hvlnCustomers', JSON.stringify(customers));
      localStorage.setItem('hvlnInventory', JSON.stringify(inventory));
      localStorage.setItem('hvlnSuppliers', JSON.stringify(suppliers));
      localStorage.setItem('hvlnProductDetails', JSON.stringify(productDetails));

      if (currentUser) {
        localStorage.setItem('hvlnCurrentUser', JSON.stringify(currentUser));
      } else {
        localStorage.removeItem('hvlnCurrentUser');
      }

      if (currentRole) {
        localStorage.setItem('hvlnCurrentRole', currentRole);
      } else {
        localStorage.removeItem('hvlnCurrentRole');
      }
    } catch {
      // Ignore storage quota errors
    }
  }, [
    products,
    cart,
    orders,
    customers,
    inventory,
    suppliers,
    productDetails,
    currentUser,
    currentRole,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem('hvlnReviews', JSON.stringify(reviews));
    } catch {
      // Ignore storage quota errors
    }
  }, [reviews]);

  // Load initial data from Supabase (with automatic localStorage / PHP fallback)
  useEffect(() => {
    let active = true;

    async function loadFromSupabase() {
      if (!supabase) return false;

      try {
        const [
          productsRes,
          suppliersRes,
          customersRes,
          ordersRes,
          orderItemsRes,
          reviewsRes,
        ] = await Promise.all([
          supabase.from('products').select('*').order('id', { ascending: true }),
          supabase.from('suppliers').select('*').order('id', { ascending: true }),
          supabase.from('customers').select('*').order('id', { ascending: true }),
          supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false }),
          supabase.from('order_items').select('*').order('id', { ascending: true }),
          supabase.from('reviews').select('*').order('id', { ascending: false }),
        ]);

        if (!active) return true;

        if (!productsRes.error && Array.isArray(productsRes.data) && productsRes.data.length > 0) {
          const nextInventory: Record<number, number> = {};
          const nextDetails: Record<number, ProductDetail> = {};

          const loadedProducts: Product[] = productsRes.data.map(
            (row: Record<string, unknown>) => {
              const id = Number(row.id);
              const stock = Math.max(0, Number(row.stock) || 0);
              nextInventory[id] = stock;
              nextDetails[id] = {
                supplierId:
                  row.supplier_id !== null && row.supplier_id !== undefined
                    ? String(row.supplier_id)
                    : '',
                expirationDate: row.expiration_date
                  ? String(row.expiration_date)
                  : '',
              };

              return {
                id,
                name: String(row.name || 'Unnamed Product'),
                category: String(row.category || 'Uncategorized'),
                price: Number(row.price) || 0,
                image: String(row.image || ''),
                description: String(
                  row.description || 'Quality footwear from HVLN Shop.'
                ),
                sizes: String(row.sizes || DEFAULT_SIZES),
                stock,
              };
            }
          );

          setProducts(loadedProducts);
          setInventory(nextInventory);
          setProductDetails(nextDetails);
        }

        if (!suppliersRes.error && Array.isArray(suppliersRes.data)) {
          const loadedSuppliers: Supplier[] = suppliersRes.data.map(
            (row: Record<string, unknown>) => ({
              id: Number(row.id),
              supplierNumber: String(row.supplier_number || ''),
              name: String(row.name || ''),
              contact: String(row.contact || ''),
              email: String(row.email || ''),
              address: String(row.address || ''),
            })
          );
          setSuppliers(loadedSuppliers);
        }

        if (!customersRes.error && Array.isArray(customersRes.data)) {
          const loadedCustomers: Customer[] = customersRes.data.map(
            (row: Record<string, unknown>) => ({
              id: (row.id as number | string) || Date.now(),
              customerNumber: row.customer_number
                ? String(row.customer_number)
                : undefined,
              name: String(row.name || ''),
              username: String(row.username || ''),
              password: row.password ? String(row.password) : undefined,
              email: String(row.email || ''),
              contact: String(row.contact || ''),
              address: String(row.address || ''),
            })
          );
          setCustomers(loadedCustomers);
        }

        if (!ordersRes.error && Array.isArray(ordersRes.data)) {
          const itemsByOrderId: Record<string, OrderItem[]> = {};
          if (!orderItemsRes.error && Array.isArray(orderItemsRes.data)) {
            orderItemsRes.data.forEach((itemRow: Record<string, unknown>) => {
              const ordId = String(itemRow.order_id || '');
              if (!ordId) return;
              if (!itemsByOrderId[ordId]) itemsByOrderId[ordId] = [];
              itemsByOrderId[ordId].push({
                productId: Number(itemRow.product_id) || 0,
                name: String(itemRow.name || ''),
                image: String(itemRow.image || ''),
                size: itemRow.size ? String(itemRow.size) : undefined,
                price: Number(itemRow.price) || 0,
                quantity: Number(itemRow.quantity) || 1,
                subtotal: Number(itemRow.subtotal) || 0,
              });
            });
          }

          const loadedOrders: Order[] = ordersRes.data.map(
            (row: Record<string, unknown>) => {
              const id = String(row.id);
              const rawBuyer =
                row.buyer && typeof row.buyer === 'object'
                  ? (row.buyer as Record<string, unknown>)
                  : null;
              const rawItems = Array.isArray(row.items)
                ? (row.items as OrderItem[])
                : [];
              const normalizedItems =
                itemsByOrderId[id] && itemsByOrderId[id].length > 0
                  ? itemsByOrderId[id]
                  : rawItems;

              return {
                id,
                date: String(
                  row.order_date ||
                    (row.created_at
                      ? new Date(String(row.created_at)).toLocaleString()
                      : '')
                ),
                customerUsername: row.customer_username
                  ? String(row.customer_username)
                  : null,
                buyer: {
                  name: String(
                    rawBuyer?.name ?? row.buyer_name ?? 'Walk-in Customer'
                  ),
                  username: String(rawBuyer?.username ?? row.buyer_username ?? ''),
                  email: String(rawBuyer?.email ?? row.buyer_email ?? ''),
                  contact: String(rawBuyer?.contact ?? row.buyer_contact ?? ''),
                  address: String(rawBuyer?.address ?? row.buyer_address ?? ''),
                },
                items: normalizedItems,
                total: Number(row.total) || 0,
                payment: String(row.payment || 'Cash'),
                status: String(row.status || 'Pending'),
                returnReason: row.return_reason
                  ? String(row.return_reason)
                  : undefined,
                returnDate: row.return_date ? String(row.return_date) : undefined,
              };
            }
          );

          setOrders(loadedOrders);
        }

        if (!reviewsRes.error && Array.isArray(reviewsRes.data) && reviewsRes.data.length > 0) {
          const loadedReviews: Review[] = reviewsRes.data.map(
            (row: Record<string, unknown>) => ({
              id: Number(row.id),
              name: String(row.name || 'Customer'),
              username: row.username ? String(row.username) : undefined,
              rating: Number(row.rating) || 5,
              comment: String(row.comment || ''),
              date: String(row.review_date || ''),
            })
          );
          setReviews(loadedReviews);
        }

        return !productsRes.error;
      } catch {
        return false;
      }
    }

    async function loadProductsFromDatabase() {
      const loadedFromSupabase = await loadFromSupabase();
      if (loadedFromSupabase || !active) return;

      const res = await tryJsonFetch('api/get_products.php');
      if (!active || !res || !res.ok) return;
      const { data } = res;
      if (!data.success || !Array.isArray(data.products)) return;

      const loaded: Product[] = data.products.map((item: Record<string, unknown>) => ({
        id: Number(item.id),
        name: String(item.product_name || item.name || 'Unnamed Product'),
        category: String(item.category || 'Uncategorized'),
        price: Number(item.price) || 0,
        image: String(item.image_url || item.image || ''),
        description: String(item.description || 'Quality footwear from HVLN Shop.'),
        sizes: String(item.sizes || '6,7,8,9,10'),
        stock: Math.max(0, Number(item.stock) || 0),
      }));

      setProducts(loaded);
      setInventory((prev) => {
        const next = { ...prev };
        loaded.forEach((p) => {
          next[p.id] = p.stock;
        });
        return next;
      });
      setProductDetails((prev) => {
        const next = { ...prev };
        loaded.forEach((p) => {
          if (!next[p.id]) {
            next[p.id] = { supplierId: '', expirationDate: '' };
          }
        });
        return next;
      });
    }

    loadProductsFromDatabase();
    return () => {
      active = false;
    };
  }, []);

  const cartCount = useMemo(
    () => cart.reduce((total, item) => total + Number(item.quantity), 0),
    [cart]
  );

  const cartTotal = useMemo(() => {
    let sum = 0;
    for (const item of cart) {
      const product = products.find((p) => Number(p.id) === Number(item.productId));
      if (!product) continue;
      sum += Number(product.price) * Number(item.quantity);
    }
    return roundCurrency(sum);
  }, [cart, products]);

  const posTotal = useMemo(() => {
    let sum = 0;
    for (const item of posCart) {
      const product = products.find((p) => Number(p.id) === Number(item.productId));
      if (!product) continue;
      sum += Number(product.price) * Number(item.quantity);
    }
    return roundCurrency(sum);
  }, [posCart, products]);

  const totalRecordedSales = useMemo(() => {
    return roundCurrency(
      orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0)
    );
  }, [orders]);

  const displayedProducts = useMemo(() => {
    if (!categoryFilter || categoryFilter === 'All') {
      return products;
    }
    return products.filter(
      (p) => String(p.category || '').toLowerCase() === categoryFilter.toLowerCase()
    );
  }, [products, categoryFilter]);

  const visibleOrders = useMemo(() => {
    if (!currentUser) return [];
    if (currentRole === 'owner') return orders;
    return orders.filter((order) => order.customerUsername === currentUser.username);
  }, [orders, currentUser, currentRole]);

  const getProductStock = (product: Product): number => {
    const val = inventory[product.id];
    return Math.max(0, Number(val ?? product.stock ?? 0));
  };

  const getSelectedSizeForProduct = (product: Product): string => {
    const available = parseSizes(product.sizes);
    const current = selectedSizes[product.id];
    if (current && available.includes(current)) {
      return current;
    }
    return available[0];
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.src !== FALLBACK_IMAGE) {
      img.src = FALLBACK_IMAGE;
    }
  };

  // Navigation
  const openLogin = () => {
    setLoginMessage('');
    setShowLoginModal(true);
  };

  const openSignup = () => {
    setShowLoginModal(false);
    setSignupMessage('');
    setShowSignupModal(true);
  };

  const openOwnerLogin = () => {
    setOwnerLoginMessage('');
    setShowOwnerLoginModal(true);
  };

  const showPage = (pageId: PageId) => {
    if (!isLoggedIn) return;

    if (
      (pageId === 'home' || pageId === 'products' || pageId === 'categories') &&
      currentRole === 'owner'
    ) {
      setActivePage('inventory');
      return;
    }

    if ((pageId === 'inventory' || pageId === 'pos') && currentRole !== 'owner') {
      openOwnerLogin();
      return;
    }

    if (pageId === 'orders' && currentRole !== 'customer') {
      openLogin();
      return;
    }

    if (pageId === 'products') {
      setCategoryFilter(null);
    }

    setActivePage(pageId);
  };

  const filterCategory = (category: string) => {
    setCategoryFilter(category);
    setActivePage('products');
  };

  // Cart & Buy Now
  const addToCart = (productId: number, chosenSize?: string) => {
    if (currentRole === 'owner') {
      showAlert('Cart is only available for customers.');
      return;
    }

    const product = products.find((p) => Number(p.id) === Number(productId));
    if (!product) return;

    const stock = getProductStock(product);
    if (stock <= 0) {
      showAlert('This product is out of stock.');
      return;
    }

    const totalAlreadyInCart = getCartQtyForProduct(cart, product.id);
    if (totalAlreadyInCart >= stock) {
      showAlert('You cannot add more than the available stock.');
      return;
    }

    const size = chosenSize || getSelectedSizeForProduct(product);

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.productId === product.id && (item.size || '') === size
      );
      if (existingIndex !== -1) {
        return prev.map((item, idx) =>
          idx === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { productId: product.id, size, quantity: 1 }];
    });

    showAlert(`${product.name} added to cart.`);
  };

  const openCart = () => {
    if (currentRole === 'owner') {
      showAlert('Cart is not available for the owner.');
      return;
    }
    setShowCartModal(true);
  };

  const changeQuantity = (index: number, change: number) => {
    const item = cart[index];
    if (!item) return;

    const product = products.find((p) => Number(p.id) === Number(item.productId));
    const stock = product ? getProductStock(product) : 0;
    const newQuantity = Number(item.quantity) + Number(change);

    if (newQuantity <= 0) {
      setCart((prev) => prev.filter((_, idx) => idx !== index));
      return;
    }

    if (change > 0) {
      const totalForProduct = getCartQtyForProduct(cart, item.productId);
      if (totalForProduct + change > stock) {
        showAlert('Not enough stock available.');
        return;
      }
    }

    setCart((prev) =>
      prev.map((entry, idx) =>
        idx === index ? { ...entry, quantity: newQuantity } : entry
      )
    );
  };

  const removeFromCart = (index: number) => {
    setCart((prev) => prev.filter((_, idx) => idx !== index));
  };

  const openCheckoutWithCart = (targetCart: CartItem[]) => {
    if (currentRole !== 'customer' || !currentUser || 'role' in currentUser) {
      setShowCartModal(false);
      openLogin();
      return;
    }

    if (targetCart.length === 0) {
      showAlert('Your cart is empty.');
      return;
    }

    const totalsByProduct: Record<number, number> = {};
    for (const item of targetCart) {
      totalsByProduct[item.productId] =
        (totalsByProduct[item.productId] || 0) + Number(item.quantity);
    }

    for (const [prodIdStr, qty] of Object.entries(totalsByProduct)) {
      const product = products.find((p) => Number(p.id) === Number(prodIdStr));
      if (!product) continue;
      const stock = getProductStock(product);
      if (qty > stock) {
        showAlert(`Not enough stock for ${product.name}`);
        return;
      }
    }

    setCheckoutName(currentUser.name || '');
    setCheckoutEmail(currentUser.email || '');
    setCheckoutContact(currentUser.contact || '');
    setCheckoutAddress(currentUser.address || '');
    setCheckoutPayment('');
    setShowCartModal(false);
    setShowCheckoutModal(true);
  };

  const buyNow = (productId: number, chosenSize?: string) => {
    if (currentRole === 'owner') {
      showAlert('Buying products is only available for customers.');
      return;
    }

    const product = products.find((p) => Number(p.id) === Number(productId));
    if (!product) return;

    const stock = getProductStock(product);
    if (stock <= 0) {
      showAlert('This product is out of stock.');
      return;
    }

    const size = chosenSize || getSelectedSizeForProduct(product);
    const singleItemCart: CartItem[] = [{ productId: product.id, size, quantity: 1 }];
    setCart(singleItemCart);
    openCheckoutWithCart(singleItemCart);
  };

  // Customer Login
  const handleCustomerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = loginUsername.trim();
    const password = loginPassword;

    if (!username || !password) {
      setLoginMessage('Please enter your username and password.');
      return;
    }

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('customers')
          .select('*')
          .ilike('username', username)
          .eq('password', password)
          .maybeSingle();

        if (!error && data) {
          const row = data as Record<string, unknown>;
          const loggedCustomer: Customer = {
            id: (row.id as number | string) || Date.now(),
            customerNumber: row.customer_number
              ? String(row.customer_number)
              : undefined,
            name: String(row.name || ''),
            username: String(row.username || username),
            password: row.password ? String(row.password) : undefined,
            email: String(row.email || ''),
            contact: String(row.contact || ''),
            address: String(row.address || ''),
          };

          setCurrentUser(loggedCustomer);
          setCurrentRole('customer');
          setShowLoginModal(false);
          setLoginUsername('');
          setLoginPassword('');
          setLoginMessage('');
          setActivePage('home');
          showAlert('Customer login successful!');
          return;
        }
      } catch {
        // Fallback to PHP/localStorage if Supabase request fails
      }
    }

    const res = await tryJsonFetch('api/login_customer.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (res) {
      const { ok, data } = res;
      if (!ok || !data.success || !data.customer) {
        setLoginMessage(
          String(data.message || 'Invalid customer username or password.')
        );
        return;
      }

      const apiCust = data.customer as Record<string, unknown>;
      const loggedCustomer: Customer = {
        id: (apiCust.customer_id as number | string) || Date.now(),
        name: String(apiCust.full_name || ''),
        username: String(apiCust.username || username),
        email: String(apiCust.email || ''),
        contact: String(apiCust.contact_number || ''),
        address: String(apiCust.address || ''),
      };

      setCurrentUser(loggedCustomer);
      setCurrentRole('customer');
      setShowLoginModal(false);
      setLoginUsername('');
      setLoginPassword('');
      setLoginMessage('');
      setActivePage('home');
      showAlert('Customer login successful!');
      return;
    }

    const localCustomer = customers.find(
      (c) =>
        c.username.toLowerCase() === username.toLowerCase() &&
        c.password === password
    );

    if (localCustomer) {
      setCurrentUser(localCustomer);
      setCurrentRole('customer');
      setShowLoginModal(false);
      setLoginUsername('');
      setLoginPassword('');
      setLoginMessage('');
      setActivePage('home');
      showAlert('Customer login successful!');
      return;
    }

    setLoginMessage('Invalid customer username or password.');
  };

  // Customer Signup
  const handleCustomerSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    const name = signupName.trim();
    const username = signupUsername.trim();
    const password = signupPassword;
    const email = signupEmail.trim();
    const contact = signupContact.trim();
    const address = signupAddress.trim();

    if (!name || !username || !password || !email || !contact || !address) {
      setSignupMessage('Please complete all required fields.');
      return;
    }

    const nextCustomerNumber = getNextNumber(
      customers.map((c) => c.customerNumber),
      'CUST'
    );

    if (supabase) {
      try {
        const { data: existingUser } = await supabase
          .from('customers')
          .select('id')
          .ilike('username', username)
          .maybeSingle();

        if (existingUser) {
          setSignupMessage('Username already exists.');
          return;
        }

        const { data: inserted, error } = await supabase
          .from('customers')
          .insert({
            customer_number: nextCustomerNumber,
            name,
            username,
            password,
            email,
            contact,
            address,
          })
          .select('*')
          .single();

        if (!error && inserted) {
          const row = inserted as Record<string, unknown>;
          const newCustomer: Customer = {
            id: (row.id as number | string) || Date.now(),
            customerNumber: String(row.customer_number || nextCustomerNumber),
            name: String(row.name || name),
            username: String(row.username || username),
            password: String(row.password || password),
            email: String(row.email || email),
            contact: String(row.contact || contact),
            address: String(row.address || address),
          };

          setCustomers((prev) => [...prev, newCustomer]);
          setCurrentUser(newCustomer);
          setCurrentRole('customer');
          setShowSignupModal(false);
          setSignupName('');
          setSignupUsername('');
          setSignupPassword('');
          setSignupEmail('');
          setSignupContact('');
          setSignupAddress('');
          setSignupMessage('');
          setActivePage('home');
          showAlert('Customer account created successfully!');
          return;
        }
      } catch {
        // Fallback to PHP/localStorage if Supabase request fails
      }
    }

    const res = await tryJsonFetch('api/register_customer.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: name,
        username,
        password,
        email,
        contact,
        address,
      }),
    });

    if (res) {
      const { ok, data } = res;
      if (!ok || !data.success) {
        setSignupMessage(String(data.message || 'Registration failed.'));
        return;
      }

      const newCustomer: Customer = {
        id: (data.id as number | string) || Date.now(),
        customerNumber: nextCustomerNumber,
        name,
        username,
        password,
        email,
        contact,
        address,
      };

      setCustomers((prev) => [...prev, newCustomer]);
      setCurrentUser(newCustomer);
      setCurrentRole('customer');
      setShowSignupModal(false);
      setSignupName('');
      setSignupUsername('');
      setSignupPassword('');
      setSignupEmail('');
      setSignupContact('');
      setSignupAddress('');
      setSignupMessage('');
      setActivePage('home');
      showAlert('Customer account created successfully!');
      return;
    }

    if (customers.some((c) => c.username.toLowerCase() === username.toLowerCase())) {
      setSignupMessage('Username already exists.');
      return;
    }

    const newCustomer: Customer = {
      id: Date.now(),
      customerNumber: nextCustomerNumber,
      name,
      username,
      password,
      email,
      contact,
      address,
    };

    setCustomers((prev) => [...prev, newCustomer]);
    setCurrentUser(newCustomer);
    setCurrentRole('customer');
    setShowSignupModal(false);
    setSignupName('');
    setSignupUsername('');
    setSignupPassword('');
    setSignupEmail('');
    setSignupContact('');
    setSignupAddress('');
    setSignupMessage('');
    setActivePage('home');
    showAlert('Customer account created successfully!');
  };

  // Customer Logout
  const customerLogout = () => {
    setCurrentUser(null);
    setCurrentRole(null);
    setCart([]);
    setCategoryFilter(null);
    setActivePage('home');
    showAlert('Customer logged out successfully.');
  };

  // Owner Login
  const handleOwnerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = ownerUsername.trim();
    const password = ownerPassword;

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('owners')
          .select('*')
          .eq('username', username)
          .eq('password', password)
          .maybeSingle();

        if (!error && data) {
          const row = data as Record<string, unknown>;
          setCurrentUser({
            name: String(row.name || 'HVLN Shop Owner'),
            username: String(row.username || username),
            role: 'owner',
          });
          setCurrentRole('owner');
          setShowOwnerLoginModal(false);
          setOwnerUsername('');
          setOwnerPassword('');
          setOwnerLoginMessage('');
          setActivePage('inventory');
          showAlert('Owner login successful!');
          return;
        }
      } catch {
        // Fallback to local hardcoded owner check
      }
    }

    if (username === 'anthony' && password === 'ADMINBSCS') {
      setCurrentUser({
        name: 'HVLN Shop Owner',
        username: 'anthony',
        role: 'owner',
      });
      setCurrentRole('owner');
      setShowOwnerLoginModal(false);
      setOwnerUsername('');
      setOwnerPassword('');
      setOwnerLoginMessage('');
      setActivePage('inventory');
      showAlert('Owner login successful!');
    } else {
      setOwnerLoginMessage('Invalid owner username or password.');
    }
  };

  // Owner Logout
  const ownerLogout = () => {
    setCurrentUser(null);
    setCurrentRole(null);
    setPosCart([]);
    setCategoryFilter(null);
    setActivePage('home');
    showAlert('Owner logged out successfully.');
  };

  // Checkout Submit
  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (currentRole !== 'customer' || !currentUser || 'role' in currentUser) {
      showAlert('Please login as a customer first.');
      return;
    }

    if (cart.length === 0) {
      showAlert('Your cart is empty.');
      return;
    }

    const name = checkoutName.trim();
    const contact = checkoutContact.trim();
    const email = checkoutEmail.trim();
    const address = checkoutAddress.trim();
    const payment = checkoutPayment;

    if (!name || !contact || !email || !address || !payment) {
      showAlert('Please complete all checkout information.');
      return;
    }

    const totalsByProduct: Record<number, number> = {};
    for (const item of cart) {
      totalsByProduct[item.productId] =
        (totalsByProduct[item.productId] || 0) + Number(item.quantity);
    }

    for (const [prodIdStr, qty] of Object.entries(totalsByProduct)) {
      const product = products.find((p) => Number(p.id) === Number(prodIdStr));
      if (!product) continue;
      const stock = getProductStock(product);
      if (qty > stock) {
        showAlert(`Not enough stock for ${product.name}`);
        return;
      }
    }

    let total = 0;
    const orderItems: OrderItem[] = [];

    for (const item of cart) {
      const product = products.find((p) => Number(p.id) === Number(item.productId));
      if (!product) continue;

      const subtotal = roundCurrency(Number(product.price) * Number(item.quantity));
      total = roundCurrency(total + subtotal);

      orderItems.push({
        productId: product.id,
        name: product.name,
        image: product.image,
        size: item.size || 'Not selected',
        price: Number(product.price),
        quantity: Number(item.quantity),
        subtotal,
      });
    }

    if (orderItems.length === 0) {
      showAlert('Your cart has no valid products.');
      return;
    }

    const newOrder: Order = {
      id: `ORD-${Date.now()}`,
      date: new Date().toLocaleString(),
      customerUsername: currentUser.username,
      buyer: {
        name,
        username: currentUser.username,
        email,
        contact,
        address,
      },
      items: orderItems,
      total,
      payment,
      status: 'Pending',
    };

    const nextInventory = { ...inventory };
    for (const [prodIdStr, qty] of Object.entries(totalsByProduct)) {
      const pid = Number(prodIdStr);
      nextInventory[pid] = Math.max(0, Number(nextInventory[pid] ?? 0) - qty);
    }

    if (supabase) {
      const sb = supabase;
      try {
        await sb.from('orders').insert({
          id: newOrder.id,
          order_date: newOrder.date,
          customer_username: newOrder.customerUsername,
          buyer: newOrder.buyer,
          items: newOrder.items,
          buyer_name: newOrder.buyer.name,
          buyer_username: newOrder.buyer.username,
          buyer_email: newOrder.buyer.email,
          buyer_contact: newOrder.buyer.contact,
          buyer_address: newOrder.buyer.address,
          total: newOrder.total,
          payment: newOrder.payment,
          status: newOrder.status,
        });

        await sb.from('order_items').insert(
          orderItems.map((item) => ({
            order_id: newOrder.id,
            product_id: item.productId,
            name: item.name,
            image: item.image,
            size: item.size || '',
            price: item.price,
            quantity: item.quantity,
            subtotal: item.subtotal,
          }))
        );

        await Promise.all(
          Object.keys(totalsByProduct).map((prodIdStr) => {
            const pid = Number(prodIdStr);
            return sb
              .from('products')
              .update({ stock: nextInventory[pid] })
              .eq('id', pid);
          })
        );

        await sb
          .from('customers')
          .update({ name, email, contact, address })
          .eq('username', currentUser.username);
      } catch {
        // Proceed with local state update even if offline
      }
    }

    setOrders((prev) => [newOrder, ...prev]);
    setInventory(nextInventory);
    setProducts((prev) =>
      prev.map((p) =>
        nextInventory[p.id] !== undefined ? { ...p, stock: nextInventory[p.id] } : p
      )
    );

    const updatedCustomer: Customer = {
      ...currentUser,
      name,
      email,
      contact,
      address,
    };

    setCustomers((prev) =>
      prev.map((c) =>
        c.username === currentUser.username
          ? { ...c, name, email, contact, address }
          : c
      )
    );
    setCurrentUser(updatedCustomer);

    setCart([]);
    setShowCheckoutModal(false);
    setCheckoutPayment('');
    setActivePage('orders');
    showAlert(`Order placed successfully!\n\nOrder ID: ${newOrder.id}`);
  };

  // Return Order
  const requestReturn = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    if (
      currentRole !== 'customer' ||
      !currentUser ||
      order.customerUsername !== currentUser.username
    ) {
      showAlert('You cannot return this order.');
      return;
    }

    if (order.status === 'Return Requested') {
      showAlert('A return request has already been submitted for this order.');
      return;
    }

    setSelectedReturnOrderId(orderId);
    setReturnReason('');
    setShowReturnModal(true);
  };

  const closeReturnModal = () => {
    setShowReturnModal(false);
    setSelectedReturnOrderId(null);
    setReturnReason('');
  };

  const submitReturnRequest = async () => {
    const reason = returnReason.trim();
    if (!reason) {
      showAlert('Please enter a reason for the return.');
      return;
    }

    if (!selectedReturnOrderId) return;

    const returnDate = new Date().toLocaleString();

    if (supabase) {
      try {
        await supabase
          .from('orders')
          .update({
            status: 'Return Requested',
            return_reason: reason,
            return_date: returnDate,
          })
          .eq('id', selectedReturnOrderId);
      } catch {
        // Continue with local state update
      }
    }

    setOrders((prev) =>
      prev.map((order) =>
        order.id === selectedReturnOrderId
          ? {
              ...order,
              status: 'Return Requested',
              returnReason: reason,
              returnDate,
            }
          : order
      )
    );

    closeReturnModal();
    showAlert('Return request submitted successfully.');
  };

  // Inventory Edit
  const openInventoryEditor = (productId: number) => {
    if (currentRole !== 'owner') {
      openOwnerLogin();
      return;
    }

    const product = products.find((p) => Number(p.id) === Number(productId));
    if (!product) return;

    const details = productDetails[product.id] || {
      supplierId: '',
      expirationDate: '',
    };

    setSelectedInventoryProductId(product.id);
    setEditProductTitle(`Product: ${product.name}`);
    setEditProductName(product.name || '');
    setEditProductPrice(String(Number(product.price) || 0));
    setEditProductImage(product.image || '');
    setEditProductSizes(product.sizes || DEFAULT_SIZES);
    setEditProductStock(String(getProductStock(product)));
    setEditProductSupplier(details.supplierId || '');
    setEditProductExpiration(details.expirationDate || '');
    setShowInventoryModal(true);
  };

  const saveInventory = async () => {
    if (currentRole !== 'owner') {
      openOwnerLogin();
      return;
    }

    const product = products.find(
      (p) => Number(p.id) === Number(selectedInventoryProductId)
    );
    if (!product) {
      showAlert('Product not found.');
      return;
    }

    const name = editProductName.trim();
    const priceRaw = editProductPrice.trim();
    const image = editProductImage.trim();
    const stockRaw = editProductStock.trim();

    if (!name) {
      showAlert('Please enter a product name.');
      return;
    }

    const price = Number(priceRaw);
    if (priceRaw === '' || !Number.isFinite(price) || price < 0) {
      showAlert('Enter a valid price.');
      return;
    }

    if (!image) {
      showAlert('Please enter an image URL.');
      return;
    }

    const stock = Number(stockRaw);
    if (stockRaw === '' || !Number.isInteger(stock) || stock < 0) {
      showAlert('Enter a valid whole-number stock quantity.');
      return;
    }

    const normalizedSizes =
      editProductSizes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ') || DEFAULT_SIZES;

    let updatedInSupabase = false;

    if (supabase) {
      try {
        const supplierIdNum =
          editProductSupplier && Number.isFinite(Number(editProductSupplier))
            ? Number(editProductSupplier)
            : null;

        const { error } = await supabase
          .from('products')
          .update({
            name,
            price,
            image,
            sizes: normalizedSizes,
            stock,
            supplier_id: supplierIdNum,
            expiration_date: editProductExpiration || '',
          })
          .eq('id', Number(product.id));

        if (!error) {
          updatedInSupabase = true;
        }
      } catch {
        // Fallback to PHP/localStorage
      }
    }

    const res = !updatedInSupabase
      ? await tryJsonFetch('api/update_product.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: Number(product.id),
            name,
            price,
            image,
            sizes: normalizedSizes,
            stock,
            supplierId: editProductSupplier,
            expirationDate: editProductExpiration,
          }),
        })
      : null;

    if (res && (!res.ok || !res.data.success)) {
      showAlert(String(res.data.message || 'Unable to update product.'));
      return;
    }

    setProducts((prev) =>
      prev.map((p) =>
        Number(p.id) === Number(product.id)
          ? {
              ...p,
              name,
              price,
              image,
              sizes: normalizedSizes,
              stock,
            }
          : p
      )
    );

    setInventory((prev) => ({
      ...prev,
      [product.id]: stock,
    }));

    setProductDetails((prev) => ({
      ...prev,
      [product.id]: {
        supplierId: editProductSupplier,
        expirationDate: editProductExpiration,
      },
    }));

    // Keep POS cart quantities within updated stock bounds
    setPosCart((prev) =>
      prev
        .map((item) =>
          item.productId === product.id
            ? { ...item, quantity: Math.min(item.quantity, stock) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );

    setShowInventoryModal(false);
    setSelectedInventoryProductId(null);

    if (updatedInSupabase || res) {
      showAlert('Product information updated successfully!');
    } else {
      showAlert('Product information updated locally!');
    }
  };

  // Suppliers
  const addSupplier = async () => {
    if (currentRole !== 'owner') {
      openOwnerLogin();
      return;
    }

    const name = supplierName.trim();
    const contact = supplierContact.trim();
    const email = supplierEmail.trim();
    const address = supplierAddress.trim();

    if (!name) {
      showAlert('Please enter supplier name.');
      return;
    }

    const nextSupplierNumber = getNextNumber(
      suppliers.map((s) => s.supplierNumber),
      'SUP'
    );

    let newSupplier: Supplier = {
      id: Date.now(),
      supplierNumber: nextSupplierNumber,
      name,
      contact,
      email,
      address,
    };

    if (supabase) {
      try {
        const { data: inserted, error } = await supabase
          .from('suppliers')
          .insert({
            supplier_number: nextSupplierNumber,
            name,
            contact,
            email,
            address,
          })
          .select('*')
          .single();

        if (!error && inserted) {
          const row = inserted as Record<string, unknown>;
          newSupplier = {
            id: Number(row.id) || Date.now(),
            supplierNumber: String(row.supplier_number || nextSupplierNumber),
            name: String(row.name || name),
            contact: String(row.contact || contact),
            email: String(row.email || email),
            address: String(row.address || address),
          };
        }
      } catch {
        // Fallback to local state
      }
    }

    setSuppliers((prev) => [...prev, newSupplier]);
    setSupplierName('');
    setSupplierContact('');
    setSupplierEmail('');
    setSupplierAddress('');
    showAlert('Supplier added successfully.');
  };

  const deleteSupplier = (index: number) => {
    if (currentRole !== 'owner') {
      openOwnerLogin();
      return;
    }

    const supplier = suppliers[index];
    if (!supplier) return;

    const used = Object.values(productDetails).some(
      (details) => String(details.supplierId) === String(supplier.id)
    );

    if (used) {
      showAlert(
        'This supplier is currently assigned to a product. Change the product supplier first.'
      );
      return;
    }

    showConfirm('Are you sure you want to delete this supplier?', async () => {
      if (supabase) {
        try {
          await supabase.from('suppliers').delete().eq('id', supplier.id);
        } catch {
          // Fallback to local deletion
        }
      }
      setSuppliers((prev) => prev.filter((_, idx) => idx !== index));
      showAlert('Supplier deleted successfully.');
    });
  };

  // Point of Sale
  const addToPOS = (productId: number) => {
    if (currentRole !== 'owner') {
      openOwnerLogin();
      return;
    }

    const product = products.find((p) => Number(p.id) === Number(productId));
    if (!product) return;

    const stock = getProductStock(product);
    if (stock <= 0) {
      showAlert('Not enough stock.');
      return;
    }

    const existing = posCart.find((item) => item.productId === product.id);
    if (existing) {
      if (existing.quantity >= stock) {
        showAlert('Not enough stock.');
        return;
      }
      setPosCart((prev) =>
        prev.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      setPosCart((prev) => [...prev, { productId: product.id, quantity: 1 }]);
    }
  };

  const removePOSItem = (index: number) => {
    setPosCart((prev) => prev.filter((_, idx) => idx !== index));
  };

  const completePOSOrder = () => {
    if (currentRole !== 'owner') {
      openOwnerLogin();
      return;
    }

    if (posCart.length === 0) {
      showAlert('POS cart is empty.');
      return;
    }

    for (const item of posCart) {
      const product = products.find((p) => Number(p.id) === Number(item.productId));
      if (!product) continue;
      const stock = getProductStock(product);
      if (item.quantity > stock) {
        showAlert(`Not enough stock for ${product.name}`);
        return;
      }
    }

    setPosBuyerName('');
    setPosBuyerContact('');
    setPosBuyerEmail('');
    setPosBuyerAddress('');
    setShowPosCheckoutModal(true);
  };

  const handleConfirmPOSSale = async (e: React.FormEvent) => {
    e.preventDefault();

    const buyerName = posBuyerName.trim();
    if (!buyerName) {
      showAlert('Please enter customer name.');
      return;
    }

    let total = 0;
    const items: OrderItem[] = [];

    for (const item of posCart) {
      const product = products.find((p) => Number(p.id) === Number(item.productId));
      if (!product) continue;

      const stock = getProductStock(product);
      if (item.quantity > stock) {
        showAlert(`Not enough stock for ${product.name}`);
        return;
      }

      const subtotal = roundCurrency(Number(product.price) * Number(item.quantity));
      total = roundCurrency(total + subtotal);

      items.push({
        productId: product.id,
        name: product.name,
        image: product.image,
        price: Number(product.price),
        quantity: Number(item.quantity),
        subtotal,
      });
    }

    if (items.length === 0) {
      showAlert('POS cart is empty.');
      return;
    }

    const newOrder: Order = {
      id: `POS-${Date.now()}`,
      date: new Date().toLocaleString(),
      customerUsername: null,
      buyer: {
        name: buyerName,
        username: '',
        email: posBuyerEmail.trim(),
        contact: posBuyerContact.trim(),
        address: posBuyerAddress.trim(),
      },
      items,
      total,
      payment: 'Cash',
      status: 'Completed - POS',
    };

    const nextInventory = { ...inventory };
    posCart.forEach((item) => {
      nextInventory[item.productId] = Math.max(
        0,
        Number(nextInventory[item.productId] ?? 0) - Number(item.quantity)
      );
    });

    if (supabase) {
      const sb = supabase;
      try {
        await sb.from('orders').insert({
          id: newOrder.id,
          order_date: newOrder.date,
          customer_username: null,
          buyer: newOrder.buyer,
          items: newOrder.items,
          buyer_name: newOrder.buyer.name,
          buyer_username: '',
          buyer_email: newOrder.buyer.email,
          buyer_contact: newOrder.buyer.contact,
          buyer_address: newOrder.buyer.address,
          total: newOrder.total,
          payment: newOrder.payment,
          status: newOrder.status,
        });

        await sb.from('order_items').insert(
          items.map((item) => ({
            order_id: newOrder.id,
            product_id: item.productId,
            name: item.name,
            image: item.image,
            size: '',
            price: item.price,
            quantity: item.quantity,
            subtotal: item.subtotal,
          }))
        );

        await Promise.all(
          posCart.map((item) =>
            sb
              .from('products')
              .update({ stock: nextInventory[item.productId] })
              .eq('id', item.productId)
          )
        );
      } catch {
        // Proceed with local state update even if offline
      }
    }

    setOrders((prev) => [newOrder, ...prev]);
    setInventory(nextInventory);
    setProducts((prev) =>
      prev.map((p) =>
        nextInventory[p.id] !== undefined ? { ...p, stock: nextInventory[p.id] } : p
      )
    );
    setPosCart([]);
    setShowPosCheckoutModal(false);
    showAlert(`POS sale completed successfully!\n\nOrder ID: ${newOrder.id}`);
  };

  // Reviews
  const submitReview = async () => {
    if (currentRole !== 'customer' || !currentUser || 'role' in currentUser) {
      openLogin();
      return;
    }

    const rating = Math.max(1, Math.min(5, Math.floor(Number(reviewRating) || 5)));
    const comment = reviewComment.trim();

    if (!comment) {
      showAlert('Please write a comment first.');
      return;
    }

    const reviewDate = new Date().toLocaleString();
    let newReview: Review = {
      id: Date.now(),
      name: currentUser.name,
      username: currentUser.username,
      rating,
      comment,
      date: reviewDate,
    };

    if (supabase) {
      try {
        const { data: inserted, error } = await supabase
          .from('reviews')
          .insert({
            name: currentUser.name,
            username: currentUser.username,
            rating,
            comment,
            review_date: reviewDate,
          })
          .select('*')
          .single();

        if (!error && inserted) {
          const row = inserted as Record<string, unknown>;
          newReview = {
            id: Number(row.id) || Date.now(),
            name: String(row.name || currentUser.name),
            username: row.username ? String(row.username) : currentUser.username,
            rating: Number(row.rating) || rating,
            comment: String(row.comment || comment),
            date: String(row.review_date || reviewDate),
          };
        }
      } catch {
        // Fallback to local state
      }
    }

    setReviews((prev) => [newReview, ...prev]);
    setReviewRating('5');
    setReviewComment('');
    showAlert('Your review has been submitted successfully!');
  };

  const renderProductCard = (product: Product, keyPrefix: string) => {
    const stock = getProductStock(product);
    const availableSizes = parseSizes(product.sizes);
    const chosenSize = getSelectedSizeForProduct(product);

    return (
      <div className="product-card" key={`${keyPrefix}-${product.id}`}>
        <img
          src={product.image || FALLBACK_IMAGE}
          alt={product.name || 'HVLN Shop'}
          onError={handleImageError}
        />
        <div className="product-info">
          <span className="category">{product.category}</span>
          <h3>{product.name}</h3>
          <p>{product.description}</p>
          <div className="price">₱{Number(product.price).toFixed(2)}</div>
          <div className="stock">Stock: {stock}</div>

          <div className="form-group">
            <label htmlFor={`${keyPrefix}-size-${product.id}`}>Size</label>
            <select
              id={`${keyPrefix}-size-${product.id}`}
              value={chosenSize}
              onChange={(e) =>
                setSelectedSizes((prev) => ({
                  ...prev,
                  [product.id]: e.target.value,
                }))
              }
              required
            >
              {availableSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div className="product-buttons">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => addToCart(product.id, chosenSize)}
              disabled={stock <= 0}
            >
              Add to Cart
            </button>
            <button
              type="button"
              className="btn btn-warning"
              onClick={() => buyNow(product.id, chosenSize)}
              disabled={stock <= 0}
            >
              Buy Now
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {isLoggedIn && (
        <header>
          <div className="header-container">
            <div
              className="logo"
              onClick={() => {
                if (isLoggedIn) {
                  showPage(currentRole === 'owner' ? 'inventory' : 'home');
                }
              }}
            >
              <img src="/logo.jpg" alt="HVLN Shop Logo" className="brand-logo" />
              <div>
                HVLN <span>Shop</span>
              </div>
            </div>

            <nav id="shopNavigation">
              {currentRole !== 'owner' && (
                <>
                  <button
                    type="button"
                    className="nav-btn"
                    onClick={() => showPage('home')}
                  >
                    Shop
                  </button>

                  <button
                    type="button"
                    className="nav-btn"
                    onClick={() => showPage('products')}
                  >
                    Products
                  </button>

                  <button
                    type="button"
                    className="nav-btn"
                    onClick={() => showPage('categories')}
                  >
                    Categories
                  </button>
                </>
              )}

              <button
                type="button"
                className="nav-btn"
                onClick={() => showPage('reviews')}
              >
                Reviews
              </button>

              {currentRole === 'customer' && (
                <button
                  type="button"
                  className="nav-btn"
                  id="myOrdersNav"
                  onClick={() => showPage('orders')}
                >
                  My Orders
                </button>
              )}

              {currentRole === 'owner' && (
                <>
                  <button
                    type="button"
                    className="nav-btn"
                    onClick={() => showPage('inventory')}
                  >
                    Inventory
                  </button>

                  <button
                    type="button"
                    className="nav-btn"
                    onClick={() => showPage('pos')}
                  >
                    Point of Sale
                  </button>
                </>
              )}

              <button
                type="button"
                className="nav-btn"
                onClick={() => showPage('account')}
              >
                Account
              </button>

              {currentRole !== 'owner' && (
                <button
                  type="button"
                  className="nav-btn cart-btn"
                  id="cartButton"
                  onClick={openCart}
                >
                  🛒 Cart (<span id="cartCount">{cartCount}</span>)
                </button>
              )}
            </nav>
          </div>
        </header>
      )}

      {/* LOGIN GATEWAY: SPLIT-CARD DESIGN WITH LOGO ON LEFT SIDE */}
      {!isLoggedIn && (
        <section id="authScreen" className="auth-screen">
          <div className="login-split-card">
            {/* LEFT PANEL: WHITE WITH CURVED WAVE & LOGO */}
            <div className="login-left-panel">
              <div className="login-left-header">
                <img
                  src="/logo.jpg"
                  alt="HVLN Shop Logo"
                  className="login-left-mini-logo"
                />
                <div className="login-left-brand-text">
                  <strong>HVLN SHOP</strong>
                </div>
              </div>

              <div className="login-left-artwork">
                <div className="login-blob-outer">
                  <div className="login-blob-inner">
                    <img
                      src="/logo.jpg"
                      alt="HVLN Shop Logo"
                      className="login-hero-logo"
                    />
                  </div>
                </div>
                <span className="floating-dot dot-1" />
                <span className="floating-dot dot-2" />
                <span className="floating-dot dot-3" />
                <span className="floating-dot dot-4" />
              </div>

              <div className="login-left-footer">
                <p>© 2026 HVLN Shop</p>
                <p>Powered by Manielyn E. Falqueza</p>
              </div>

              {/* Smooth curved wave separator */}
              <svg
                className="login-wave-divider"
                viewBox="0 0 120 600"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d="M0,0 L40,0 C15,150 115,320 115,450 C115,525 85,570 55,600 L0,600 Z"
                  fill="#ffffff"
                />
              </svg>
            </div>

            {/* RIGHT PANEL: DEEP FOREST GREEN WITH LOGIN FORM */}
            <div className="login-right-panel">
              <div className="login-right-content">
                <div className="login-role-tabs">
                  <button
                    type="button"
                    className={`login-role-tab${
                      authLoginMode === 'customer' ? ' active' : ''
                    }`}
                    onClick={() => {
                      setAuthLoginMode('customer');
                      setLoginMessage('');
                      setOwnerLoginMessage('');
                    }}
                  >
                    Customer
                  </button>
                  <button
                    type="button"
                    className={`login-role-tab${
                      authLoginMode === 'owner' ? ' active' : ''
                    }`}
                    onClick={() => {
                      setAuthLoginMode('owner');
                      setLoginMessage('');
                      setOwnerLoginMessage('');
                    }}
                  >
                    Owner
                  </button>
                </div>

                <h1>
                  {authLoginMode === 'customer' ? 'Login' : 'Owner Login'}
                </h1>

                {authLoginMode === 'customer' ? (
                  <form
                    className="split-login-form"
                    onSubmit={handleCustomerLogin}
                  >
                    <div className="split-field">
                      <label htmlFor="splitCustomerUser">Username</label>
                      <input
                        id="splitCustomerUser"
                        type="text"
                        placeholder="Enter your username"
                        value={loginUsername}
                        onChange={(e) => setLoginUsername(e.target.value)}
                        required
                      />
                    </div>

                    <div className="split-field">
                      <label htmlFor="splitCustomerPass">Password</label>
                      <input
                        id="splitCustomerPass"
                        type="password"
                        placeholder="Enter your password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                      />
                    </div>

                    {loginMessage && (
                      <p className="split-error-msg">{loginMessage}</p>
                    )}

                    <button type="submit" className="split-submit-btn">
                      Login to Shop
                    </button>

                    <div className="split-register-prompt">
                      <span>Don&apos;t have an account?</span>
                      <button
                        type="button"
                        className="split-register-link"
                        onClick={openSignup}
                      >
                        Register Now
                      </button>
                    </div>
                  </form>
                ) : (
                  <form
                    className="split-login-form"
                    onSubmit={handleOwnerLogin}
                  >
                    <div className="split-field">
                      <label htmlFor="splitOwnerUser">Owner Username</label>
                      <input
                        id="splitOwnerUser"
                        type="text"
                        placeholder="Enter owner username"
                        value={ownerUsername}
                        onChange={(e) => setOwnerUsername(e.target.value)}
                        required
                      />
                    </div>

                    <div className="split-field">
                      <label htmlFor="splitOwnerPass">Owner Password</label>
                      <input
                        id="splitOwnerPass"
                        type="password"
                        placeholder="Enter owner password"
                        value={ownerPassword}
                        onChange={(e) => setOwnerPassword(e.target.value)}
                        required
                      />
                    </div>

                    {ownerLoginMessage && (
                      <p className="split-error-msg">{ownerLoginMessage}</p>
                    )}

                    <button type="submit" className="split-submit-btn">
                      Login as Owner
                    </button>

                    <div className="split-register-prompt">
                      <span>Store management &amp; POS access</span>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {isLoggedIn && (
        <main id="shopMain">
          {/* HOME */}
          <section
            id="home"
            className={`page${activePage === 'home' ? ' active' : ''}`}
          >
            <div className="hero">
              <h1>Welcome to HVLN Shop</h1>
              <p>Your trusted online shop for quality products.</p>
              <button
                type="button"
                className="hero-btn"
                onClick={() => showPage('products')}
              >
                Shop Now
              </button>
            </div>

            <h2 className="section-title">Featured Products</h2>

            <div id="homeProducts" className="products-grid">
              {products.slice(0, 4).map((product) => renderProductCard(product, 'home'))}
            </div>
          </section>

          {/* PRODUCTS */}
          <section
            id="products"
            className={`page${activePage === 'products' ? ' active' : ''}`}
          >
            <h2 className="section-title">Our Products</h2>

            <div id="productGrid" className="products-grid">
              {displayedProducts.length === 0 ? (
                <p>No products found in this category.</p>
              ) : (
                displayedProducts.map((product) =>
                  renderProductCard(product, 'products')
                )
              )}
            </div>
          </section>

          {/* CATEGORIES */}
          <section
            id="categories"
            className={`page${activePage === 'categories' ? ' active' : ''}`}
          >
            <h2 className="section-title">Categories</h2>

            <div className="category-grid">
              <div
                className="category-card"
                onClick={() => filterCategory('Slippers')}
              >
                <h3>Slippers</h3>
                <p>Comfortable slippers for everyday use.</p>
              </div>

              <div
                className="category-card"
                onClick={() => filterCategory('Sandals')}
              >
                <h3>Sandals</h3>
                <p>Stylish sandals for different occasions.</p>
              </div>

              <div
                className="category-card"
                onClick={() => filterCategory('Flip-Flops')}
              >
                <h3>Flip-Flops</h3>
                <p>Lightweight and comfortable footwear.</p>
              </div>
            </div>
          </section>

          {/* REVIEWS */}
          <section
            id="reviews"
            className={`page${activePage === 'reviews' ? ' active' : ''}`}
          >
            <h2 className="section-title">Customer Reviews</h2>

            <div id="reviewFormContainer">
              {currentRole !== 'customer' ? (
                <div className="login-review-message">
                  <h3>Want to leave a review?</h3>
                  <p className="review-comment">
                    Please login as a customer first.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={openLogin}
                  >
                    Customer Login
                  </button>
                </div>
              ) : (
                <div className="review-form">
                  <h3>Write a Review</h3>
                  <br />
                  <div className="form-group">
                    <label htmlFor="reviewRating">Rating</label>
                    <select
                      id="reviewRating"
                      value={reviewRating}
                      onChange={(e) => setReviewRating(e.target.value)}
                    >
                      <option value="5">★★★★★ - Excellent</option>
                      <option value="4">★★★★☆ - Very Good</option>
                      <option value="3">★★★☆☆ - Good</option>
                      <option value="2">★★☆☆☆ - Fair</option>
                      <option value="1">★☆☆☆☆ - Poor</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="reviewComment">Your Comment</label>
                    <textarea
                      id="reviewComment"
                      rows={4}
                      placeholder="Write your comment here..."
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      required
                    />
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={submitReview}
                  >
                    Submit Review
                  </button>
                </div>
              )}
            </div>

            <div id="reviewsContainer" className="reviews-grid">
              {reviews.length === 0 ? (
                <p>No reviews yet.</p>
              ) : (
                reviews.map((review) => {
                  const clamped = Math.max(
                    0,
                    Math.min(5, Math.floor(Number(review.rating) || 0))
                  );
                  const stars = '★'.repeat(clamped) + '☆'.repeat(5 - clamped);
                  return (
                    <div className="review-card" key={review.id}>
                      <div className="stars">{stars}</div>
                      <h3>{review.name}</h3>
                      <p className="review-comment">{review.comment}</p>
                      {review.date && (
                        <small className="review-date">{review.date}</small>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* ORDERS */}
          <section
            id="orders"
            className={`page${activePage === 'orders' ? ' active' : ''}`}
          >
            <h2 className="section-title">My Orders</h2>

            <div id="ordersContainer">
              {!currentUser ? (
                <div className="account-details">
                  <p>Please login as a customer to view your orders.</p>
                  <br />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={openLogin}
                  >
                    Customer Login
                  </button>
                </div>
              ) : visibleOrders.length === 0 ? (
                <p>No orders found.</p>
              ) : (
                visibleOrders.map((order) => {
                  const isReturnRequested = order.status === 'Return Requested';
                  return (
                    <div className="order-card" key={order.id}>
                      <div className="order-header">
                        <div>
                          <strong>{order.id}</strong>
                          <p>{order.date}</p>
                        </div>
                        <span className="status">{order.status}</span>
                      </div>

                      <p>
                        <strong>Customer:</strong> {order.buyer.name}
                      </p>
                      <p>
                        <strong>Payment:</strong> {order.payment}
                      </p>

                      {order.returnReason && (
                        <p className="pos-sale-total">
                          <strong>Return Reason:</strong> {order.returnReason}
                        </p>
                      )}

                      <br />

                      {order.items.map((item, idx) => {
                        const orderedProduct = products.find(
                          (p) => Number(p.id) === Number(item.productId)
                        );
                        const orderedImage =
                          item.image || (orderedProduct ? orderedProduct.image : '');
                        return (
                          <div className="order-item" key={`${order.id}-item-${idx}`}>
                            <img
                              src={orderedImage || FALLBACK_IMAGE}
                              alt={item.name}
                              onError={handleImageError}
                            />
                            <div className="order-item-info">
                              <strong>{item.name}</strong>
                              <p>
                                {item.size ? `Size: ${item.size} · ` : ''}Qty:{' '}
                                {item.quantity}
                              </p>
                              <small>₱{Number(item.subtotal).toFixed(2)}</small>
                            </div>
                          </div>
                        );
                      })}

                      <div className="total">
                        Total: ₱{Number(order.total).toFixed(2)}
                      </div>

                      {currentRole === 'customer' && (
                        <>
                          <br />
                          <button
                            type="button"
                            className="btn btn-warning"
                            disabled={isReturnRequested}
                            onClick={() => requestReturn(order.id)}
                          >
                            {isReturnRequested ? 'Return Requested' : 'Return Order'}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* INVENTORY */}
          <section
            id="inventory"
            className={`page${activePage === 'inventory' ? ' active' : ''}`}
          >
            <h2 className="section-title">Inventory Management</h2>

            <div className="inventory-menu">
              <button
                type="button"
                className={`inventory-tab${
                  activeInventoryTab === 'productList' ? ' active' : ''
                }`}
                onClick={() => setActiveInventoryTab('productList')}
              >
                Product List
              </button>

              <button
                type="button"
                className={`inventory-tab${
                  activeInventoryTab === 'customerList' ? ' active' : ''
                }`}
                onClick={() => setActiveInventoryTab('customerList')}
              >
                Customer List
              </button>

              <button
                type="button"
                className={`inventory-tab${
                  activeInventoryTab === 'supplierList' ? ' active' : ''
                }`}
                onClick={() => setActiveInventoryTab('supplierList')}
              >
                Supplier List
              </button>

              <button
                type="button"
                className={`inventory-tab${
                  activeInventoryTab === 'expirationList' ? ' active' : ''
                }`}
                onClick={() => setActiveInventoryTab('expirationList')}
              >
                Expiration List
              </button>
            </div>

            {/* PRODUCT LIST */}
            <div
              id="productList"
              className={`inventory-section${
                activeInventoryTab === 'productList' ? ' active' : ''
              }`}
            >
              <h3 className="inventory-section-title">Product List</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>Product Name</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Size</th>
                      <th>Stock</th>
                      <th>Supplier</th>
                      <th>Expiration</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody id="inventoryTable">
                    {currentRole === 'owner' &&
                      products.map((product) => {
                        const stock = getProductStock(product);
                        const details = productDetails[product.id] || {
                          supplierId: '',
                          expirationDate: '',
                        };
                        const supplier = suppliers.find(
                          (s) => String(s.id) === String(details.supplierId)
                        );
                        const supplierDisplay = supplier
                          ? supplier.name
                          : 'No Supplier';
                        const expirationDisplay =
                          details.expirationDate || 'No expiration';

                        return (
                          <tr key={product.id}>
                            <td>
                              <img
                                src={product.image || FALLBACK_IMAGE}
                                alt={product.name}
                                className="inventory-thumb"
                                onError={handleImageError}
                              />
                            </td>
                            <td>{product.name}</td>
                            <td>{product.category}</td>
                            <td>₱{Number(product.price).toFixed(2)}</td>
                            <td>{product.sizes || DEFAULT_SIZES}</td>
                            <td>{stock}</td>
                            <td>{supplierDisplay}</td>
                            <td>{expirationDisplay}</td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => openInventoryEditor(product.id)}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* CUSTOMER LIST */}
            <div
              id="customerList"
              className={`inventory-section${
                activeInventoryTab === 'customerList' ? ' active' : ''
              }`}
            >
              <h3 className="inventory-section-title">Customer List</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Customer #</th>
                      <th>Name</th>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Contact</th>
                      <th>Address</th>
                    </tr>
                  </thead>
                  <tbody id="customersTable">
                    {currentRole === 'owner' &&
                      (customers.length === 0 ? (
                        <tr>
                          <td colSpan={6}>No customers registered.</td>
                        </tr>
                      ) : (
                        customers.map((customer) => (
                          <tr key={String(customer.id)}>
                            <td>{customer.customerNumber || '-'}</td>
                            <td>{customer.name}</td>
                            <td>{customer.username}</td>
                            <td>{customer.email}</td>
                            <td>{customer.contact}</td>
                            <td>{customer.address || '-'}</td>
                          </tr>
                        ))
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SUPPLIER LIST */}
            <div
              id="supplierList"
              className={`inventory-section${
                activeInventoryTab === 'supplierList' ? ' active' : ''
              }`}
            >
              <h3 className="inventory-section-title">Supplier List</h3>

              <div className="supplier-form-box">
                <h3 className="inventory-section-title">Add Supplier</h3>

                <div className="form-group">
                  <label htmlFor="supplierName">Supplier Name</label>
                  <input
                    type="text"
                    id="supplierName"
                    placeholder="Enter supplier name"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="supplierContact">Contact Number</label>
                  <input
                    type="text"
                    id="supplierContact"
                    placeholder="Enter contact number"
                    value={supplierContact}
                    onChange={(e) => setSupplierContact(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="supplierEmail">Email</label>
                  <input
                    type="email"
                    id="supplierEmail"
                    placeholder="Enter supplier email"
                    value={supplierEmail}
                    onChange={(e) => setSupplierEmail(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="supplierAddress">Address</label>
                  <input
                    type="text"
                    id="supplierAddress"
                    placeholder="Enter supplier address"
                    value={supplierAddress}
                    onChange={(e) => setSupplierAddress(e.target.value)}
                  />
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={addSupplier}
                >
                  Add Supplier
                </button>
              </div>

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Supplier #</th>
                      <th>Supplier Name</th>
                      <th>Contact</th>
                      <th>Email</th>
                      <th>Address</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody id="supplierTable">
                    {currentRole === 'owner' &&
                      (suppliers.length === 0 ? (
                        <tr>
                          <td colSpan={6}>No suppliers added yet.</td>
                        </tr>
                      ) : (
                        suppliers.map((supplier, index) => (
                          <tr key={supplier.id}>
                            <td>{supplier.supplierNumber}</td>
                            <td>{supplier.name}</td>
                            <td>{supplier.contact}</td>
                            <td>{supplier.email}</td>
                            <td>{supplier.address}</td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => deleteSupplier(index)}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* EXPIRATION LIST */}
            <div
              id="expirationList"
              className={`inventory-section${
                activeInventoryTab === 'expirationList' ? ' active' : ''
              }`}
            >
              <h3 className="inventory-section-title">Expiration List</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Supplier</th>
                      <th>Expiration Date</th>
                      <th>Status</th>
                      <th>Stock</th>
                    </tr>
                  </thead>
                  <tbody id="expirationTable">
                    {currentRole === 'owner' &&
                      products.map((product) => {
                        const details = productDetails[product.id] || {
                          supplierId: '',
                          expirationDate: '',
                        };
                        const supplier = suppliers.find(
                          (s) => String(s.id) === String(details.supplierId)
                        );
                        const supplierDisplay = supplier
                          ? supplier.name
                          : 'No Supplier';
                        const stock = getProductStock(product);
                        const { status, statusClass } = getExpirationStatus(
                          details.expirationDate
                        );

                        return (
                          <tr key={product.id}>
                            <td>{product.name}</td>
                            <td>{supplierDisplay}</td>
                            <td>{details.expirationDate || 'No expiration'}</td>
                            <td className={statusClass}>{status}</td>
                            <td>{stock}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* POS */}
          <section
            id="pos"
            className={`page${activePage === 'pos' ? ' active' : ''}`}
          >
            <h2 className="section-title">Point of Sale</h2>

            <div className="pos-container">
              <div className="pos-products">
                <h3>Products</h3>
                <div id="posProducts">
                  {currentRole === 'owner' &&
                    products.map((product) => {
                      const stock = getProductStock(product);
                      return (
                        <div className="pos-product" key={product.id}>
                          <div>
                            <strong>{product.name}</strong>
                            <br />₱{Number(product.price).toFixed(2)}
                            <br />
                            <small>Stock: {stock}</small>
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => addToPOS(product.id)}
                            disabled={stock <= 0}
                          >
                            Add
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="pos-cart">
                <h3>POS Cart</h3>
                <div id="posCart">
                  {posCart.length === 0 ? (
                    <p>No items in POS cart.</p>
                  ) : (
                    posCart.map((item, index) => {
                      const product = products.find(
                        (p) => Number(p.id) === Number(item.productId)
                      );
                      if (!product) return null;
                      const subtotal = roundCurrency(
                        Number(product.price) * Number(item.quantity)
                      );
                      return (
                        <div className="pos-cart-item" key={`${item.productId}-${index}`}>
                          <img
                            src={product.image || FALLBACK_IMAGE}
                            alt={product.name}
                            className="pos-cart-thumb"
                            onError={handleImageError}
                          />
                          <span>
                            {product.name} × {item.quantity}
                          </span>
                          <strong>₱{subtotal.toFixed(2)}</strong>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => removePOSItem(index)}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="total">
                  Total: ₱<span id="posTotal">{posTotal.toFixed(2)}</span>
                </div>

                <br />

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={completePOSOrder}
                >
                  Complete POS Sale
                </button>
              </div>

              <div className="pos-sales-history">
                <h3>Sales History</h3>
                <p className="muted-note">
                  Completed customer orders and POS transactions, including the
                  buyer&apos;s name and total sales.
                </p>
                <div id="posSalesHistory">
                  {currentRole === 'owner' &&
                    (orders.length === 0 ? (
                      <p className="muted-note">No sales recorded yet.</p>
                    ) : (
                      <>
                        <div className="sales-total-banner">
                          Total Recorded Sales: ₱{totalRecordedSales.toFixed(2)}
                        </div>
                        {orders.map((order) => (
                          <div className="pos-sale-card" key={order.id}>
                            <div className="pos-sale-header">
                              <strong>{order.id}</strong>
                              <span className="status">
                                {order.status || 'Completed'}
                              </span>
                            </div>
                            <p className="muted-note">
                              <strong>Customer / Buyer:</strong>{' '}
                              {order.buyer?.name || 'Walk-in Customer'}
                            </p>
                            <p>
                              <strong>Date:</strong> {order.date || ''}
                            </p>
                            <p>
                              <strong>Payment:</strong>{' '}
                              {order.payment || 'Not specified'}
                            </p>
                            <p>
                              <strong>Items:</strong>{' '}
                              {(order.items || [])
                                .map(
                                  (item) =>
                                    `${item.name} × ${Number(item.quantity) || 0}`
                                )
                                .join(', ')}
                            </p>
                            <p className="pos-sale-total">
                              Sale Total: ₱{Number(order.total || 0).toFixed(2)}
                            </p>
                          </div>
                        ))}
                      </>
                    ))}
                </div>
              </div>
            </div>
          </section>

          {/* ACCOUNT */}
          <section
            id="account"
            className={`page${activePage === 'account' ? ' active' : ''}`}
          >
            <h2 className="section-title">Account</h2>

            <div id="accountContent">
              {!currentUser ? (
                <div className="account-details">
                  <h2>Welcome to HVLN Shop</h2>
                  <p className="review-comment">
                    Please login to access your account.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={openLogin}
                  >
                    Customer Login
                  </button>
                </div>
              ) : currentRole === 'owner' ? (
                <div className="account-details">
                  <h2>Owner Account</h2>
                  <div className="account-row">
                    <strong>Name:</strong> HVLN Shop Owner
                  </div>
                  <div className="account-row">
                    <strong>Username:</strong> anthony
                  </div>
                  <div className="account-row">
                    <strong>Role:</strong> Website Owner
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger logout-account"
                    onClick={ownerLogout}
                  >
                    Owner Logout
                  </button>
                </div>
              ) : (
                <div className="account-details">
                  <h2>Customer Account</h2>
                  <div className="account-row">
                    <strong>Name:</strong> {currentUser.name}
                  </div>
                  <div className="account-row">
                    <strong>Username:</strong> {currentUser.username}
                  </div>
                  <div className="account-row">
                    <strong>Email:</strong>{' '}
                    {'email' in currentUser ? currentUser.email : ''}
                  </div>
                  <div className="account-row">
                    <strong>Contact:</strong>{' '}
                    {'contact' in currentUser ? currentUser.contact : ''}
                  </div>
                  <div className="account-row">
                    <strong>Address:</strong>{' '}
                    {'address' in currentUser ? currentUser.address : ''}
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger logout-account"
                    onClick={customerLogout}
                  >
                    Customer Logout
                  </button>
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      {isLoggedIn && (
        <footer id="shopFooter">
          <p>Manielyn E. Falqueza</p>
          <p>HVLN Shop © 2026</p>
        </footer>
      )}

      {/* CUSTOMER LOGIN MODAL */}
      <div
        id="loginModal"
        className={`modal${showLoginModal ? ' show' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowLoginModal(false);
        }}
      >
        <div className="modal-box">
          <button
            className="close"
            type="button"
            onClick={() => setShowLoginModal(false)}
          >
            ×
          </button>

          <h2>Customer Login</h2>

          <form id="loginForm" onSubmit={handleCustomerLogin}>
            <div className="form-group">
              <label htmlFor="loginUsername">Username</label>
              <input
                type="text"
                id="loginUsername"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="loginPassword">Password</label>
              <input
                type="password"
                id="loginPassword"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>

            <p
              id="loginMessage"
              className={`message${loginMessage ? ' error' : ''}`}
            >
              {loginMessage}
            </p>

            <div className="product-buttons">
              <button className="btn btn-primary" type="submit">
                Customer Login
              </button>

              <button
                className="btn btn-secondary"
                type="button"
                onClick={openSignup}
              >
                Create Account
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* CUSTOMER SIGNUP MODAL */}
      <div
        id="signupModal"
        className={`modal${showSignupModal ? ' show' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowSignupModal(false);
        }}
      >
        <div className="modal-box">
          <button
            className="close"
            type="button"
            onClick={() => setShowSignupModal(false)}
          >
            ×
          </button>

          <h2>Create Customer Account</h2>

          <form id="signupForm" onSubmit={handleCustomerSignup}>
            <div className="form-group">
              <label htmlFor="signupName">Full Name</label>
              <input
                type="text"
                id="signupName"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="signupUsername">Username</label>
              <input
                type="text"
                id="signupUsername"
                value={signupUsername}
                onChange={(e) => setSignupUsername(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="signupPassword">Password</label>
              <input
                type="password"
                id="signupPassword"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="signupEmail">Email</label>
              <input
                type="email"
                id="signupEmail"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="signupContact">Contact Number</label>
              <input
                type="text"
                id="signupContact"
                value={signupContact}
                onChange={(e) => setSignupContact(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="signupAddress">Address</label>
              <textarea
                id="signupAddress"
                rows={3}
                value={signupAddress}
                onChange={(e) => setSignupAddress(e.target.value)}
                required
              />
            </div>

            <p
              id="signupMessage"
              className={`message${signupMessage ? ' error' : ''}`}
            >
              {signupMessage}
            </p>

            <div className="product-buttons">
              <button className="btn btn-primary" type="submit">
                Create Account
              </button>

              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  setShowSignupModal(false);
                  openLogin();
                }}
              >
                Back to Login
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* OWNER LOGIN MODAL */}
      <div
        id="ownerLoginModal"
        className={`modal${showOwnerLoginModal ? ' show' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowOwnerLoginModal(false);
        }}
      >
        <div className="modal-box">
          <button
            className="close"
            type="button"
            onClick={() => setShowOwnerLoginModal(false)}
          >
            ×
          </button>

          <h2>Owner Login</h2>

          <p className="modal-subtext">
            This login is only for the HVLN Shop owner.
          </p>

          <form id="ownerLoginForm" onSubmit={handleOwnerLogin}>
            <div className="form-group">
              <label htmlFor="ownerUsername">Owner Username</label>
              <input
                type="text"
                id="ownerUsername"
                value={ownerUsername}
                onChange={(e) => setOwnerUsername(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="ownerPassword">Owner Password</label>
              <input
                type="password"
                id="ownerPassword"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                required
              />
            </div>

            <p
              id="ownerLoginMessage"
              className={`message${ownerLoginMessage ? ' error' : ''}`}
            >
              {ownerLoginMessage}
            </p>

            <button className="btn btn-primary" type="submit">
              Owner Login
            </button>
          </form>
        </div>
      </div>

      {/* CART MODAL */}
      <div
        id="cartModal"
        className={`modal${showCartModal ? ' show' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowCartModal(false);
        }}
      >
        <div className="modal-box large">
          <button
            className="close"
            type="button"
            onClick={() => setShowCartModal(false)}
          >
            ×
          </button>

          <h2>Your Shopping Cart</h2>

          <div id="cartItems">
            {cart.length === 0 ? (
              <p>Your cart is empty.</p>
            ) : (
              cart.map((item, index) => {
                const product = products.find(
                  (p) => Number(p.id) === Number(item.productId)
                );
                if (!product) return null;
                const subtotal = roundCurrency(
                  Number(product.price) * Number(item.quantity)
                );

                return (
                  <div
                    className="cart-item"
                    key={`${item.productId}-${item.size}-${index}`}
                  >
                    <img
                      className="cart-product-image"
                      src={product.image || FALLBACK_IMAGE}
                      alt={product.name}
                      onError={handleImageError}
                    />
                    <div className="cart-item-info">
                      <strong>{product.name}</strong>
                      <p>Size: {item.size || 'Not selected'}</p>
                      <p>₱{Number(product.price).toFixed(2)}</p>
                    </div>
                    <div className="quantity-controls">
                      <button
                        type="button"
                        onClick={() => changeQuantity(index, -1)}
                      >
                        -
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => changeQuantity(index, 1)}
                      >
                        +
                      </button>
                    </div>
                    <strong>₱{subtotal.toFixed(2)}</strong>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => removeFromCart(index)}
                    >
                      Remove
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="cart-total">
            Total: ₱<span id="cartTotal">{cartTotal.toFixed(2)}</span>
          </div>

          <br />

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openCheckoutWithCart(cart)}
          >
            Proceed to Checkout
          </button>
        </div>
      </div>

      {/* CHECKOUT MODAL */}
      <div
        id="checkoutModal"
        className={`modal${showCheckoutModal ? ' show' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowCheckoutModal(false);
        }}
      >
        <div className="modal-box">
          <button
            className="close"
            type="button"
            onClick={() => setShowCheckoutModal(false)}
          >
            ×
          </button>

          <h2>Checkout</h2>

          <h3 className="review-comment">Order Summary</h3>
          <div id="checkoutItems">
            {cart.map((item, idx) => {
              const product = products.find(
                (p) => Number(p.id) === Number(item.productId)
              );
              if (!product) return null;
              const subtotal = roundCurrency(
                Number(product.price) * Number(item.quantity)
              );

              return (
                <div
                  className="checkout-item"
                  key={`${item.productId}-${item.size}-${idx}`}
                >
                  <img
                    src={product.image || FALLBACK_IMAGE}
                    alt={product.name}
                    onError={handleImageError}
                  />
                  <div className="checkout-item-info">
                    <strong>{product.name}</strong>
                    <p>Size: {item.size || 'Not selected'}</p>
                    <small>Quantity: {Number(item.quantity)}</small>
                  </div>
                  <strong>₱{subtotal.toFixed(2)}</strong>
                </div>
              );
            })}
          </div>

          <form id="checkoutForm" onSubmit={handleCheckoutSubmit}>
            <div className="form-group">
              <label htmlFor="checkoutName">Full Name</label>
              <input
                type="text"
                id="checkoutName"
                value={checkoutName}
                onChange={(e) => setCheckoutName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="checkoutContact">Contact Number</label>
              <input
                type="text"
                id="checkoutContact"
                value={checkoutContact}
                onChange={(e) => setCheckoutContact(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="checkoutEmail">Email</label>
              <input
                type="email"
                id="checkoutEmail"
                value={checkoutEmail}
                onChange={(e) => setCheckoutEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="checkoutAddress">Delivery Address</label>
              <textarea
                id="checkoutAddress"
                rows={4}
                value={checkoutAddress}
                onChange={(e) => setCheckoutAddress(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="checkoutPayment">Payment Method</label>
              <select
                id="checkoutPayment"
                value={checkoutPayment}
                onChange={(e) => setCheckoutPayment(e.target.value)}
                required
              >
                <option value="">Select Payment</option>
                <option value="Cash on Delivery">Cash on Delivery</option>
                <option value="GCash">GCash</option>
              </select>
            </div>

            <p>
              Total:{' '}
              <strong>
                ₱<span id="checkoutTotal">{cartTotal.toFixed(2)}</span>
              </strong>
            </p>

            <br />

            <button className="btn btn-primary" type="submit">
              Place Order
            </button>
          </form>
        </div>
      </div>

      {/* INVENTORY EDIT MODAL */}
      <div
        id="inventoryModal"
        className={`modal${showInventoryModal ? ' show' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowInventoryModal(false);
        }}
      >
        <div className="modal-box">
          <button
            className="close"
            type="button"
            onClick={() => setShowInventoryModal(false)}
          >
            ×
          </button>

          <h2>Update Product</h2>

          <p id="inventoryProductName" className="modal-subtext">
            {editProductTitle}
          </p>

          <div className="form-group">
            <label htmlFor="inventoryProductNameInput">Product Name</label>
            <input
              type="text"
              id="inventoryProductNameInput"
              value={editProductName}
              onChange={(e) => setEditProductName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="inventoryPrice">Price</label>
            <input
              type="number"
              id="inventoryPrice"
              min="0"
              step="0.01"
              value={editProductPrice}
              onChange={(e) => setEditProductPrice(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="inventoryImage">Image URL / Path</label>
            <input
              type="text"
              id="inventoryImage"
              value={editProductImage}
              onChange={(e) => setEditProductImage(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="inventorySizes">
              Available Sizes (separate sizes with commas, e.g. 35-36, 37-38, 39-40)
            </label>
            <input
              type="text"
              id="inventorySizes"
              placeholder="35-36, 37-38, 39-40"
              value={editProductSizes}
              onChange={(e) => setEditProductSizes(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="inventoryStock">Stock Quantity</label>
            <input
              type="number"
              id="inventoryStock"
              min="0"
              value={editProductStock}
              onChange={(e) => setEditProductStock(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="inventorySupplier">Supplier</label>
            <select
              id="inventorySupplier"
              value={editProductSupplier}
              onChange={(e) => setEditProductSupplier(e.target.value)}
            >
              <option value="">Select Supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={String(supplier.id)}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="inventoryExpiration">Expiration Date</label>
            <input
              type="date"
              id="inventoryExpiration"
              value={editProductExpiration}
              onChange={(e) => setEditProductExpiration(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={saveInventory}
          >
            Save Product
          </button>
        </div>
      </div>

      {/* RETURN MODAL */}
      <div
        id="returnModal"
        className={`modal${showReturnModal ? ' show' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeReturnModal();
        }}
      >
        <div className="modal-box">
          <button
            className="close"
            type="button"
            onClick={closeReturnModal}
          >
            ×
          </button>

          <h2>Return Product</h2>

          <p id="returnOrderInfo" className="modal-subtext">
            {selectedReturnOrderId ? `Order: ${selectedReturnOrderId}` : ''}
          </p>

          <div className="form-group">
            <label htmlFor="returnReason">Reason for Return</label>
            <textarea
              id="returnReason"
              rows={4}
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              required
            />
          </div>

          <button
            type="button"
            className="btn btn-warning"
            onClick={submitReturnRequest}
          >
            Submit Return Request
          </button>
        </div>
      </div>

      {/* POS CUSTOMER DETAILS MODAL (replaces blocked window.prompt) */}
      <div
        id="posCheckoutModal"
        className={`modal${showPosCheckoutModal ? ' show' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowPosCheckoutModal(false);
        }}
      >
        <div className="modal-box">
          <button
            className="close"
            type="button"
            onClick={() => setShowPosCheckoutModal(false)}
          >
            ×
          </button>

          <h2>Complete POS Sale</h2>

          <p className="modal-subtext">
            Enter customer details to record this POS sale.
          </p>

          <form onSubmit={handleConfirmPOSSale}>
            <div className="form-group">
              <label htmlFor="posBuyerName">Customer Name</label>
              <input
                type="text"
                id="posBuyerName"
                value={posBuyerName}
                onChange={(e) => setPosBuyerName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="posBuyerContact">Customer Contact</label>
              <input
                type="text"
                id="posBuyerContact"
                value={posBuyerContact}
                onChange={(e) => setPosBuyerContact(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="posBuyerEmail">Customer Email</label>
              <input
                type="email"
                id="posBuyerEmail"
                value={posBuyerEmail}
                onChange={(e) => setPosBuyerEmail(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="posBuyerAddress">Customer Address</label>
              <textarea
                id="posBuyerAddress"
                rows={3}
                value={posBuyerAddress}
                onChange={(e) => setPosBuyerAddress(e.target.value)}
              />
            </div>

            <p>
              Total: <strong>₱{posTotal.toFixed(2)}</strong>
            </p>

            <br />

            <div className="product-buttons">
              <button className="btn btn-primary" type="submit">
                Confirm POS Sale
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setShowPosCheckoutModal(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* IN-APP ALERT / CONFIRM DIALOG (replaces blocked window.alert / window.confirm) */}
      <div
        className={`modal dialog-modal${dialog.open ? ' show' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setDialog((prev) => ({ ...prev, open: false }));
          }
        }}
      >
        <div className="modal-box">
          <button
            className="close"
            type="button"
            onClick={() => setDialog((prev) => ({ ...prev, open: false }))}
          >
            ×
          </button>

          <h2>{dialog.title}</h2>
          <p className="dialog-message">{dialog.message}</p>

          <div className="product-buttons">
            {dialog.isConfirm ? (
              <>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    const action = dialog.onConfirm;
                    setDialog((prev) => ({ ...prev, open: false }));
                    if (action) action();
                  }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setDialog((prev) => ({ ...prev, open: false }))
                  }
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setDialog((prev) => ({ ...prev, open: false }))}
              >
                OK
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
